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
analogue of the Greek<->English turn pairing in ``turns.py``. A narrated work
whose rows are Burnet's paragraphs (the Republic) has no turns to pair; its
config sets ``"unit": "paragraph"`` and the paragraph mode below aligns the
translation's paragraphs to the rows instead.

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
import math
import re
from collections import Counter
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
    # Source labels the regex swept up that canonicalise outside the reference's
    # interlocutor set, so they were dropped before aligning: {label: turn_count}.
    # Mostly stage directions, but a real speaker whose label failed to map lands
    # here too — a recurring one signals a missing speaker_map entry.
    dropped_labels: dict = field(default_factory=dict)
    cuts: int = 0               # paragraph mode: rows cut inside a translation paragraph


# ── parse the new translation into speaker turns ─────────────────────────────
def _collapse(text: str) -> str:
    return _WS.sub(" ", text).strip()


def _bounded_body(raw: str, cfg: dict) -> str:
    """The translation body, bounded below by ``start_after`` (skips a
    translator's essay / front matter) and above by ``end_marker`` (the Project
    Gutenberg footer)."""
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
    return body


def parse_new_turns(raw: str, cfg: dict) -> list[NewTurn]:
    """Split the translation body into ``(canonical speaker, text)`` turns.

    Turns are cut at line-start ALL-CAPS ``LABEL:`` markers; label -> canonical
    name via ``speaker_map`` (falling back to Title-case).
    """
    body = _bounded_body(raw, cfg)
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


# ── paragraph mode: narrated works (the Republic) ────────────────────────────
# A narrated work has no speaker turns to pair: its rows are Burnet's paragraphs
# (spine mode). A translator who paragraphs per speech exchange -- Jowett does --
# lands within a few paragraphs of the row count per book, so each row takes a
# run of the translation's text in a monotonic DP per book, scored by lexical
# cosine against the row's reference English. A paragraph may also be cut after
# its first two or before its last two sentences, at a cost: the translator now
# and then runs a short reply into the next speech ("Proceed. I will; and first
# tell me ..."), which Burnet keeps as two marks.
_BOOK = re.compile(r"^[ \t]*BOOK ([IVXL]+)\.[ \t]*$", re.M)
# A sentence end, but not before a trailing attribution ("...prefer? I said."),
# which belongs to the speech it closes.
_SENT_END = re.compile(
    r"[.?!][’”)]*\s+(?=[‘“(]?[A-Z])"
    r"(?!(?:I|he|she|they|we)\s+(?:said|replied|asked|answered|rejoined|added|continued)\b)")
SPLIT = -0.15    # cutting inside a translation paragraph
MAX_ATOMS = 24   # most atoms one row may take
BAND = 250       # DP band half-width, in atoms, around the proportional diagonal


@dataclass
class Atom:
    text: str
    starts_para: bool


def parse_new_books(raw: str, cfg: dict) -> list[list[str]]:
    """The translation body as books of paragraphs, cut at ``BOOK I.`` heads."""
    body = _bounded_body(raw, cfg)
    heads = list(_BOOK.finditer(body))
    books = []
    for k, m in enumerate(heads):
        end = heads[k + 1].start() if k + 1 < len(heads) else len(body)
        paras = (_collapse(p) for p in re.split(r"\n[ \t]*\n", body[m.end():end]))
        books.append([p for p in paras if p])
    return books


def _atoms(paras: list[str]) -> list[Atom]:
    """Cut each paragraph at the sentence ends a row boundary may fall on."""
    out: list[Atom] = []
    for p in paras:
        cuts = [m.end() for m in _SENT_END.finditer(p)]
        n = len(cuts) + 1  # sentences
        keep = [c for k, c in enumerate(cuts) if k < 2 or k >= n - 3]
        edges = [0, *keep, len(p)]
        for k in range(len(edges) - 1):
            out.append(Atom(p[edges[k]:edges[k + 1]].strip(), k == 0))
    return out


def align_paragraphs(ref_texts: list[str | None], paras: list[str]):
    """Give each reference row a run of atoms; returns ``(atoms, runs, cuts)``.

    ``runs[i]`` is ``(q, p, cosine)`` -- row i takes ``atoms[q:p]`` -- or None
    for a row left empty. Every atom is placed: the DP ends at (R, A).
    """
    atoms = _atoms(paras)
    R, A = len(ref_texts), len(atoms)
    rtok = [similarity._tokens(t or "") for t in ref_texts]
    atok = [similarity._tokens(a.text) for a in atoms]
    df: Counter[str] = Counter()
    for d in rtok + atok:
        df.update(set(d))
    n = len(rtok) + len(atok)
    idf = {t: math.log((n + 1) / (c + 1)) + 1.0 for t, c in df.items()}

    def raw_vec(d):
        return {t: c * idf[t] for t, c in Counter(d).items()}

    def dot(a, b):
        if len(a) > len(b):
            a, b = b, a
        return sum(w * b.get(t, 0.0) for t, w in a.items())

    rv = []
    for d in rtok:  # rows normalised; atoms stay raw so a run's vector is their sum
        v = raw_vec(d)
        norm = math.sqrt(sum(w * w for w in v.values())) or 1.0
        rv.append({t: w / norm for t, w in v.items()})
    av = [raw_vec(d) for d in atok]
    # run_n2[p][L] = |sum of atoms[p-L:p]|^2
    run_n2 = [[0.0] * (MAX_ATOMS + 1) for _ in range(A + 1)]
    for p in range(1, A + 1):
        acc = 0.0
        for L in range(1, min(MAX_ATOMS, p) + 1):
            q = p - L
            acc += dot(av[q], av[q]) + 2 * sum(dot(av[q], av[b]) for b in range(q + 1, p))
            run_n2[p][L] = acc

    def band(i):
        c = i * A // R if R else 0
        return max(0, c - BAND), min(A, c + BAND)

    dp = [dict() for _ in range(R + 1)]
    bk = [dict() for _ in range(R + 1)]
    dp[0][0] = 0.0
    for i in range(1, R + 1):
        r = i - 1
        lo, hi = band(i)
        base = max(0, lo - MAX_ATOMS)
        pref = [0.0]
        for a in range(base, hi):
            pref.append(pref[-1] + dot(rv[r], av[a]))
        prev, cur, ch = dp[i - 1], dp[i], bk[i]
        for p in range(lo, hi + 1):
            best, pick = prev.get(p, NEG) + GAP, 0
            cut = SPLIT if p < A and not atoms[p].starts_para else 0.0
            for L in range(1, min(MAX_ATOMS, p) + 1):
                q = p - L
                if q not in prev:
                    continue
                s = prev[q] + (pref[p - base] - pref[q - base]) / (math.sqrt(run_n2[p][L]) or 1.0) + cut
                if s > best:
                    best, pick = s, L
            if best > NEG / 2:
                cur[p], ch[p] = best, pick
    if A not in dp[R]:
        raise ValueError(f"paragraph DP found no path ({R} rows, {A} atoms); widen BAND")

    runs: list[tuple[int, int, float] | None] = [None] * R
    cuts = 0
    p = A
    for i in range(R, 0, -1):
        L = bk[i][p]
        if L:
            q = p - L
            cos = (sum(dot(rv[i - 1], av[a]) for a in range(q, p))
                   / (math.sqrt(run_n2[p][L]) or 1.0))
            runs[i - 1] = (q, p, cos)
            if p < A and not atoms[p].starts_para:
                cuts += 1
            p = q
    return atoms, runs, cuts


def run_paragraphs(cfg: dict, raw: str) -> tuple[Report, dict[Path, dict[int, dict]]]:
    work, trans_id = cfg["work"], cfg["trans_id"]
    refs = load_ref_turns(work)
    by_book: dict[Path, list[RefTurn]] = {}
    for r in refs:
        by_book.setdefault(r.book_path, []).append(r)
    books = parse_new_books(raw, cfg)
    if len(books) != len(by_book):
        raise ValueError(f"{len(books)} translation books vs {len(by_book)} reference books")

    rep = Report(work=work, trans_id=trans_id, ref_turns=len(refs),
                 new_turns=sum(len(b) for b in books))
    per_book: dict[Path, dict[int, dict]] = {}
    for (bp, rows), paras in zip(by_book.items(), books):
        atoms, runs, cuts = align_paragraphs([r.text for r in rows], paras)
        rep.cuts += cuts
        for r, run_ in zip(rows, runs):
            if r.text is None:
                rep.ineligible += 1
            if run_ is None:
                if r.text is not None:
                    rep.ref_unmatched += 1
                per_book.setdefault(bp, {})[r.index] = {"e": None}
                continue
            q, p, cos = run_
            text, ep = "", []
            for k, a in enumerate(atoms[q:p]):
                if k:
                    text += " "
                    if a.starts_para:
                        ep.append(len(text))
                text += a.text
            rep.matched += 1
            if cos <= LOW_SIM and r.text and len(r.text.split()) >= 12:
                rep.low_sim.append({
                    "ref_index": r.index, "book": bp.name, "score": round(cos, 4),
                    "ref": r.text[:90], "new": text[:90],
                })
            per_book.setdefault(bp, {})[r.index] = {"e": text, **({"ep": ep} if ep else {})}
    return rep, per_book


# ── driver: align, inject alt[], write report ────────────────────────────────
def run(cfg_path: Path) -> Report:
    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    src = (cfg_path.parent / cfg["source"]).resolve()
    raw = src.read_text(encoding="utf-8")
    if cfg.get("unit") == "paragraph":
        rep, per_book = run_paragraphs(cfg, raw)
    else:
        rep, per_book = run_turns(cfg, raw)
    return _emit(rep, per_book)


def run_turns(cfg: dict, raw: str) -> tuple[Report, dict[Path, dict[int, dict]]]:
    work, trans_id = cfg["work"], cfg["trans_id"]
    refs = load_ref_turns(work)
    # Real interlocutors, per the reference. Labels that canonicalise to
    # something outside this set are stage directions / notes (e.g. "SCENE:")
    # the label regex swept up — drop them before aligning.
    interlocutors = {r.speaker for r in refs if r.speaker}
    parsed = parse_new_turns(raw, cfg)
    news = [t for t in parsed if t.speaker in interlocutors]
    # A dropped label that recurs is almost certainly a real speaker that failed
    # to canonicalise onto the reference (e.g. Jowett "EUCLID" vs "Eucleides"
    # with no speaker_map entry) — silently dropping it strands that voice's
    # whole translation. Record every discard; main() warns on recurring ones.
    dropped = Counter(t.speaker for t in parsed if t.speaker not in interlocutors)
    pairs, sim = align(refs, news)

    rep = Report(work=work, trans_id=trans_id, ref_turns=len(refs), new_turns=len(news))
    rep.dropped_labels = dict(dropped)
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
    return rep, per_book


def _emit(rep: Report, per_book: dict[Path, dict[int, dict]]) -> Report:
    work, trans_id = rep.work, rep.trans_id
    for bp, alts in per_book.items():
        data = json.loads(bp.read_text(encoding="utf-8"))
        turns = data["turnFlow"]["turns"]
        for idx, alt in alts.items():
            slot = turns[idx].setdefault("alt", {})
            slot[trans_id] = alt
        bp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

    # The alternate is searchable only once it is in the books, so it is
    # indexed here, from the books just written: the index and the compare
    # column then always describe the same text.
    from .stage6_search import emit_translation_indexes

    emit_translation_indexes(BUILD_DIR / "dist" / work)

    report_path = BUILD_DIR / "dist" / work / f"align-{trans_id}.json"
    report_path.write_text(json.dumps({
        "work": rep.work, "trans_id": rep.trans_id,
        "ref_turns": rep.ref_turns, "new_turns": rep.new_turns,
        "matched": rep.matched, "ref_unmatched": rep.ref_unmatched,
        "new_dropped": rep.new_dropped, "ineligible": rep.ineligible,
        "dropped_labels": rep.dropped_labels,
        "cuts": rep.cuts,
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
    # A recurring dropped label is very likely a real speaker missing a
    # speaker_map entry (a one-off is usually a stage direction). Surface it
    # loudly so a whole voice never goes silently unaligned again.
    suspect = {lbl: n for lbl, n in rep.dropped_labels.items() if n >= 3}
    if suspect:
        listed = ", ".join(f"{lbl!r}×{n}" for lbl, n in sorted(
            suspect.items(), key=lambda kv: -kv[1]))
        print(f"[align_turns] WARNING: dropped recurring source speaker label(s) "
              f"not in the reference interlocutor set: {listed}. "
              f"Add a speaker_map entry in the align config if these are real "
              f"speakers, or ignore if they are stage directions.")


if __name__ == "__main__":
    main()
