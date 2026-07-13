"""Turn-level translation aligner for Stephanus dialogues.

Aligns a public-domain translation's speaker turns to a work's already-emitted
reference ``turnFlow`` (English <-> English), so the new translation inherits
Stephanus anchoring for free: every reference ``FlowTurn`` already sits at a
known Stephanus column, so a new turn matched to it renders on the same reader
row.

Dramatic dialogues parse into near-1:1 speaker turns, so a Needleman-Wunsch over
the two speaker-label sequences -- diagonal matches constrained to the SAME
canonical speaker, scored by lexical (TF-IDF) cosine, gaps for inserted/dropped
turns -- pins the mapping without embeddings. This is the English<->English
analogue of the Greek<->English turn pairing in ``turns.py``. Narrated works
(few hard turns) need the embedding aligner in ``align/`` instead -- out of
scope here.

The matched new-side text is written back onto each ``FlowTurn`` as
``alt[<trans_id>] = {"e": text}``; every reference turn gets an entry, ``e`` is
null where nothing matched (the reader renders an em-dash placeholder).

Runs as a post-stage7 step: it mutates ``build/dist/<work>/book-NN.json`` in
place (that tree is what the app reads, via the ``app/public/data`` symlink),
and writes an alignment-quality report to ``build/dist/<work>/align-<id>.json``.

    python -m plato_pipeline.align_turns --config sources/jowett-euthyphro/align.json
"""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from .align import similarity
from .config import BUILD_DIR

NEG = -1e9
# Gap penalty: a turn left unmatched costs this much. Tuned (Euthyphro sweep:
# stable plateau -0.25..-0.5) so that a distant *identical short interjection*
# ("Certainly."/"Certainly.", cos 1.0) can't out-bid the monotonic-correct
# local pairing by buying itself in with a few gaps -- the classic crossing
# trap. The same-speaker constraint on diagonal moves keeps a high penalty from
# forcing matches across a genuine one-sided insertion.
GAP = -0.35
# Matches at or below this cosine are kept (alternation still pins them) but
# surfaced in the report for a human to eyeball.
LOW_SIM = 0.12

_WS = re.compile(r"\s+")
# A speaker label opening a line: ALL-CAPS words (optionally spaced/hyphenated,
# e.g. "YOUNG SOCRATES") followed by a colon.
_LABEL = re.compile(r"^([A-Z][A-Z' .-]*[A-Z]):\s", re.M)


@dataclass
class NewTurn:
    speaker: str
    text: str


@dataclass
class RefTurn:
    book_path: Path
    index: int          # position within that book file's turnFlow.turns
    speaker: str | None
    text: str | None    # the reference (primary) English slice; None = Greek-only residual


@dataclass
class Report:
    work: str
    trans_id: str
    ref_turns: int = 0
    new_turns: int = 0
    matched: int = 0
    ref_unmatched: int = 0      # eligible reference turns with no new-side match
    new_dropped: int = 0        # new-side turns matched to nothing
    ineligible: int = 0         # reference turns with no speaker/text to match on
    low_sim: list = field(default_factory=list)


# ── parse the new translation into speaker turns ─────────────────────────────
def _collapse(text: str) -> str:
    return _WS.sub(" ", text).strip()


def parse_new_turns(raw: str, cfg: dict) -> list[NewTurn]:
    """Split the translation body into ``(canonical speaker, text)`` turns.

    The body is bounded below by ``start_after`` (skips a translator's essay /
    front matter) and above by ``end_marker`` (the Project Gutenberg footer).
    Turns are cut at line-start ALL-CAPS ``LABEL:`` markers; label -> canonical
    name via ``speaker_map`` (falling back to Title-case).
    """
    body = raw
    start_after = cfg.get("start_after")
    if start_after:
        i = body.find(start_after)
        if i == -1:
            raise ValueError(f"start_after marker not found: {start_after!r}")
        # begin at the end of that line
        body = body[body.index("\n", i) + 1:]
    end_marker = cfg.get("end_marker")
    if end_marker:
        j = body.find(end_marker)
        if j != -1:
            body = body[:j]

    smap = {k.upper(): v for k, v in cfg.get("speaker_map", {}).items()}

    def canon(label: str) -> str:
        return smap.get(label.strip().upper(), label.strip().title())

    turns: list[NewTurn] = []
    matches = list(_LABEL.finditer(body))
    for k, m in enumerate(matches):
        end = matches[k + 1].start() if k + 1 < len(matches) else len(body)
        text = _collapse(body[m.end():end])
        if text:
            turns.append(NewTurn(canon(m.group(1)), text))
    return turns


# ── load the reference turnFlow across all book files ────────────────────────
def load_ref_turns(work: str) -> list[RefTurn]:
    work_dir = BUILD_DIR / "dist" / work
    books = sorted(work_dir.glob("book-*.json"))
    if not books:
        raise FileNotFoundError(f"no emitted book JSON under {work_dir} (run the pipeline first)")
    refs: list[RefTurn] = []
    for bp in books:
        data = json.loads(bp.read_text(encoding="utf-8"))
        flow = data.get("turnFlow")
        if not flow:
            continue
        for idx, t in enumerate(flow["turns"]):
            refs.append(RefTurn(bp, idx, t.get("s"), t.get("e")))
    return refs


# ── Needleman-Wunsch over the two turn sequences ─────────────────────────────
def align(refs: list[RefTurn], news: list[NewTurn]):
    """Monotonic global alignment; returns ``(pairs, sim)``.

    ``pairs`` is a list of ``(ref_i | None, new_j | None)`` moves; ``sim`` is the
    reference x new lexical-cosine matrix (reused by the caller for reporting).

    A diagonal (match) move is only allowed when both sides carry the same
    canonical speaker (and the reference turn has text); otherwise the cell can
    only be reached by gapping. Scored by lexical cosine so that, where
    alternation alone is ambiguous, the lexically-closest pairing wins.
    """
    R, N = len(refs), len(news)
    ref_texts = [r.text or "" for r in refs]
    new_texts = [n.text for n in news]
    sim = similarity.cos_matrix(ref_texts, new_texts, "lexical")  # R x N

    def score(i: int, j: int) -> float:
        r = refs[i]
        if r.text is None or r.speaker is None:
            return NEG
        if r.speaker != news[j].speaker:
            return NEG
        return sim[i][j]

    dp = [[0.0] * (N + 1) for _ in range(R + 1)]
    bk = [["."] * (N + 1) for _ in range(R + 1)]
    for i in range(1, R + 1):
        dp[i][0] = dp[i - 1][0] + GAP
        bk[i][0] = "up"
    for j in range(1, N + 1):
        dp[0][j] = dp[0][j - 1] + GAP
        bk[0][j] = "left"
    for i in range(1, R + 1):
        for j in range(1, N + 1):
            diag = dp[i - 1][j - 1] + score(i - 1, j - 1)
            up = dp[i - 1][j] + GAP
            left = dp[i][j - 1] + GAP
            best = max(diag, up, left)
            dp[i][j] = best
            bk[i][j] = "diag" if best == diag else ("up" if best == up else "left")

    pairs: list[tuple[int | None, int | None]] = []
    i, j = R, N
    while i > 0 or j > 0:
        move = bk[i][j]
        if move == "diag":
            pairs.append((i - 1, j - 1)); i -= 1; j -= 1
        elif move == "up":
            pairs.append((i - 1, None)); i -= 1
        else:
            pairs.append((None, j - 1)); j -= 1
    pairs.reverse()
    return gap_zip(pairs, refs, news), sim


def gap_zip(pairs, refs, news):
    """Pair equal-count same-speaker gaps within each anchor-bounded run.

    NW leaves a divergence where both sides restructure the same exchange (e.g.
    a translator inserts an extra "Yes." confirmation) as parallel one-sided
    gaps, dropping otherwise-matchable turns. This is ``turns.py``'s GAP-ZIP,
    scoped to a run of gaps between two matched anchors: walk the ref-gaps and
    new-gaps in reading order and zip a pair whenever their canonical speakers
    agree, leaving genuinely one-sided turns as gaps. Order within a run is not
    preserved (the caller keys only on the ref->new mapping)."""
    result = list(pairs)
    i, n = 0, len(result)
    while i < n:
        if result[i][0] is not None and result[i][1] is not None:
            i += 1
            continue
        j = i
        while j < n and not (result[j][0] is not None and result[j][1] is not None):
            j += 1
        run = result[i:j]
        rgaps = [r for r, _ in run if r is not None]
        ngaps = [c for _, c in run if c is not None]
        paired: list[tuple[int, int]] = []
        used = [False] * len(ngaps)
        p = 0
        for r in rgaps:
            for k in range(p, len(ngaps)):
                if not used[k] and refs[r].speaker and refs[r].speaker == news[ngaps[k]].speaker:
                    paired.append((r, ngaps[k])); used[k] = True; p = k + 1
                    break
        if paired:
            pr = {r for r, _ in paired}
            pn = {c for _, c in paired}
            rebuilt = list(paired)
            rebuilt += [(r, None) for r, _ in run if r is not None and r not in pr]
            rebuilt += [(None, c) for _, c in run if c is not None and c not in pn]
            result[i:j] = rebuilt
            n = len(result)
            j = i + len(rebuilt)
        i = j
    return result


# ── driver: align, inject alt[], write report ────────────────────────────────
def run(cfg_path: Path) -> Report:
    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    work, trans_id = cfg["work"], cfg["trans_id"]
    src = (cfg_path.parent / cfg["source"]).resolve()
    raw = src.read_text(encoding="utf-8")

    refs = load_ref_turns(work)
    # Real interlocutors, per the reference. Labels that canonicalise to
    # something outside this set are stage directions / notes (e.g. "SCENE:")
    # the label regex swept up — drop them before aligning.
    interlocutors = {r.speaker for r in refs if r.speaker}
    news = [t for t in parse_new_turns(raw, cfg) if t.speaker in interlocutors]
    pairs, sim = align(refs, news)

    rep = Report(work=work, trans_id=trans_id, ref_turns=len(refs), new_turns=len(news))
    # ref index -> matched new turn (or None)
    match: dict[int, int | None] = {}
    matched_new: set[int] = set()
    for ri, nj in pairs:
        if ri is None:
            continue  # a dropped new turn (nj) — counted below
        match[ri] = nj
        if nj is not None:
            matched_new.add(nj)

    # Bucket alt entries by book file, then write each file once.
    per_book: dict[Path, dict[int, dict]] = {}
    for ri, r in enumerate(refs):
        nj = match.get(ri)
        if r.speaker is None or r.text is None:
            rep.ineligible += 1
            alt = {"e": None}
        elif nj is None:
            rep.ref_unmatched += 1
            alt = {"e": None}
        else:
            rep.matched += 1
            alt = {"e": news[nj].text}
            s = sim[ri][nj]
            if s <= LOW_SIM:
                rep.low_sim.append({
                    "ref_index": ri, "speaker": r.speaker, "score": round(s, 4),
                    "ref": (r.text or "")[:90], "new": news[nj].text[:90],
                })
        per_book.setdefault(r.book_path, {})[r.index] = alt

    rep.new_dropped = sum(1 for j in range(len(news)) if j not in matched_new)

    for bp, alts in per_book.items():
        data = json.loads(bp.read_text(encoding="utf-8"))
        turns = data["turnFlow"]["turns"]
        for idx, alt in alts.items():
            slot = turns[idx].setdefault("alt", {})
            slot[trans_id] = alt
        bp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

    report_path = BUILD_DIR / "dist" / work / f"align-{trans_id}.json"
    report_path.write_text(json.dumps({
        "work": rep.work, "trans_id": rep.trans_id,
        "ref_turns": rep.ref_turns, "new_turns": rep.new_turns,
        "matched": rep.matched, "ref_unmatched": rep.ref_unmatched,
        "new_dropped": rep.new_dropped, "ineligible": rep.ineligible,
        "low_sim": rep.low_sim,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    return rep


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="Align a translation's turns to a work's reference turnFlow.")
    ap.add_argument("--config", required=True, help="path to an align config JSON (e.g. sources/<dir>/align.json)")
    args = ap.parse_args(argv)
    cfg_path = Path(args.config).resolve()
    rep = run(cfg_path)
    print(f"[align_turns] {rep.work}/{rep.trans_id}: "
          f"{rep.matched}/{rep.ref_turns} matched, "
          f"{rep.ref_unmatched} ref-unmatched, {rep.new_dropped} new-dropped, "
          f"{rep.ineligible} ineligible, {len(rep.low_sim)} low-sim")


if __name__ == "__main__":
    main()
