"""Global turn pairing + turn-flow emission for Stephanus dialogues (stage 7).

John's Tier-0 alignment requirement: "for each speaker's statement, the first
line of that speaker's statement in Greek lines up with the first line of the
translation of that chunk in English." The turn — not the Stephanus section —
is the aligned unit; section tokens become gutter ticks.

The Greek spine emits, per segment, the turns that START in it (`speakers:
[{line, offset, label}]`); the English walker emits, per chunk, `turns:
[{offset, speaker, display}]`. Perseus and the OCT frequently file a boundary
turn under different section letters (edition drift), so pairing is GLOBAL per
book — section boundaries never break a pairing.

Pairing algorithm (correctness over coverage; a pairing is never wrong):
 1. ANCHORS — an LCS over the two sides' NAMED turn subsequences (canonical
    names, strict equality) fixes the skeleton and absorbs small count deltas
    (Euthyphro's 232 vs 233: the extra turn simply falls out of the LCS).
 2. GAP ZIP — between consecutive anchors, if the two sides have the same
    number of leftover turns and every position is name-compatible (null — the
    Greek bare dash / English who="-" — is a wildcard), zip them 1:1.
 3. COLUMN ZIP — otherwise, within the gap, zip per Stephanus column where the
    column's counts match and are compatible (the old per-section rule, now
    scoped to an anchor gap).
 4. Anything left is a RESIDUAL: it still renders, as a one-sided row in the
    flow, it just isn't level-locked to the other language.
Pairs are kept strictly monotone (reading order on both sides).

The flow emitted per book (stage7 writes it as book-NN.json's `turnFlow`) is
the merged, ordered turn list: each entry carries the Greek start ref
{c: column, n: line, o: offset} and/or the English slice text, plus speaker /
display. The reader reconstructs the Greek slices from the segments it already
has (line ids and section ticks derive from segment order), so segments — and
stages 3–6, which are segment-keyed — are untouched.
"""
from __future__ import annotations

import re
from collections import defaultdict

_DASH_PREFIX = re.compile(r"^[—\-\s<]+")


def base_siglum(label: str) -> str:
    """The base siglum of a Greek turn label: strip a leading dash, whitespace
    and stray '<' from a compound resumption marker ("— ΣΩ.", "—<ΙΠ."); a bare
    "—" normalises to "" (the unattributed turn)."""
    return _DASH_PREFIX.sub("", label).strip()


def greek_speaker(label: str, sigla: dict[str, str]) -> tuple[str | None, bool]:
    """(canonical name, mapped?) for a Greek turn label. A bare dash → (None,
    True): a legitimately unattributed turn. An unmapped non-empty siglum →
    (the base siglum, False): it can only match an identical English name, and
    `mapped=False` lets stage7's roster gate hard-fail the build."""
    base = base_siglum(label)
    if base == "":
        return None, True
    if base in sigla:
        return sigla[base], True
    return base, False


def _names_match(a: str | None, b: str | None) -> bool:
    """Two speakers agree if either is null (a dash/unattributed wildcard) or
    they are the same canonical name."""
    return a is None or b is None or a == b


# ── Pairing ──────────────────────────────────────────────────────────────────

def _lcs_pairs(a: list[str], b: list[str]) -> list[tuple[int, int]]:
    """Index pairs of a longest common subsequence of two name lists (classic
    DP; equality only). Monotone by construction."""
    n, m = len(a), len(b)
    if not n or not m:
        return []
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        ai, row, nxt = a[i], dp[i], dp[i + 1]
        for j in range(m - 1, -1, -1):
            row[j] = nxt[j + 1] + 1 if ai == b[j] else max(nxt[j], row[j + 1])
    out: list[tuple[int, int]] = []
    i = j = 0
    while i < n and j < m:
        if a[i] == b[j] and dp[i][j] == dp[i + 1][j + 1] + 1:
            out.append((i, j))
            i += 1
            j += 1
        elif dp[i + 1][j] >= dp[i][j + 1]:
            i += 1
        else:
            j += 1
    return out


def _fill_gap(g: list[dict], e: list[dict],
              gi0: int, gi1: int, ej0: int, ej1: int,
              pairs: list[tuple[int, int]]) -> None:
    """Pair the turns strictly between two anchors (exclusive index ranges).
    Equal counts + all-compatible → zip; else per-column zip where a column's
    counts match. Appends to `pairs` (may append out of global order; the
    caller sorts + enforces monotonicity)."""
    sub_g = list(range(gi0, gi1))
    sub_e = list(range(ej0, ej1))
    if not sub_g or not sub_e:
        return
    if len(sub_g) == len(sub_e) and all(
        _names_match(g[i]["name"], e[j]["speaker"]) for i, j in zip(sub_g, sub_e)
    ):
        pairs.extend(zip(sub_g, sub_e))
        return
    by_col_g: dict[str, list[int]] = defaultdict(list)
    by_col_e: dict[str, list[int]] = defaultdict(list)
    for i in sub_g:
        by_col_g[g[i]["column"]].append(i)
    for j in sub_e:
        by_col_e[e[j]["column"]].append(j)
    for col, gl in by_col_g.items():
        el = by_col_e.get(col)
        if el and len(el) == len(gl) and all(
            _names_match(g[i]["name"], e[j]["speaker"]) for i, j in zip(gl, el)
        ):
            pairs.extend(zip(gl, el))


def pair_book(g: list[dict], e: list[dict]) -> list[tuple[int, int]]:
    """Global pairing of a book's Greek turns against its English turns.
    `g` entries carry {column, name}; `e` entries {column, speaker}. Returns
    monotone (gi, ej) index pairs."""
    g_named = [i for i, t in enumerate(g) if t["name"] is not None]
    e_named = [j for j, t in enumerate(e) if t["speaker"] is not None]
    anchors = [
        (g_named[x], e_named[y])
        for x, y in _lcs_pairs([g[i]["name"] for i in g_named],
                               [e[j]["speaker"] for j in e_named])
    ]
    pairs = list(anchors)
    bounds = [(-1, -1)] + anchors + [(len(g), len(e))]
    for (agi, aej), (bgi, bej) in zip(bounds, bounds[1:]):
        _fill_gap(g, e, agi + 1, bgi, aej + 1, bej, pairs)
    pairs.sort()
    # Column-zip inside a gap can in principle cross (columns interleaving
    # between the two sides); keep only a monotone subsequence so the flow
    # renders in reading order on both sides. Dropped pairs become residuals.
    out: list[tuple[int, int]] = []
    last_e = -1
    for gi, ej in pairs:
        if ej > last_e:
            out.append((gi, ej))
            last_e = ej
    return out


# ── Turn-flow construction ───────────────────────────────────────────────────

def collect_greek_turns(book_segments: list[dict], sigla: dict[str, str],
                        ) -> tuple[list[dict], dict[str, int]]:
    """The book's Greek turns in document order, each {column, line, offset,
    name}, plus a {siglum: count} map of any unmapped sigla (roster gate)."""
    turns: list[dict] = []
    unmapped: dict[str, int] = {}
    for seg in book_segments:
        for ev in seg.get("speakers", []):
            name, ok = greek_speaker(ev["label"], sigla)
            if not ok:
                unmapped[name] = unmapped.get(name, 0) + 1
            turns.append({"column": seg["column"], "line": ev["line"],
                          "offset": ev["offset"], "name": name})
    return turns, unmapped


def collect_english_turns(book_chunks: list[dict]) -> tuple[str, list[dict]]:
    """Concatenate the book's chunk prose (single-space joined, in document
    order) and rebase each chunk's turn offsets into the joined text. Returns
    (text, turns) with turns as {column, goff, speaker, display}."""
    parts: list[str] = []
    turns: list[dict] = []
    pos = 0
    for c in book_chunks:
        t = c.get("text", "")
        if not t:
            continue
        if parts:
            parts.append(" ")
            pos += 1
        for tr in c.get("turns", []):
            turns.append({"column": c["column"], "goff": pos + tr["offset"],
                          "speaker": tr["speaker"], "display": tr["display"]})
        parts.append(t)
        pos += len(t)
    return "".join(parts), turns


def build_turn_flow(book_segments: list[dict], book_chunks: list[dict],
                    sigla: dict[str, str]) -> tuple[dict | None, dict]:
    """The per-book turn flow and its stats.

    Returns (flow, stats). `flow` is None when the book carries no Greek turn
    events (a narrated book keeps section-row rendering). Otherwise:

        {"leadE": str|None,          # English before the first English turn
         "turns": [{"s": speaker|None, "d": display|None,
                    "g": {"c","n","o"}|None,   # Greek start ref
                    "e": str|None,             # English slice text
                    "p": bool}]}               # paired?

    stats = {g_turns, e_turns, paired, g_residual, e_residual, unmapped}.
    """
    g, unmapped = collect_greek_turns(book_segments, sigla)
    text, e = collect_english_turns(book_chunks)
    if not g:
        return None, {"g_turns": 0, "e_turns": len(e), "paired": 0,
                      "g_residual": 0, "e_residual": len(e),
                      "unmapped": unmapped}
    pairs = pair_book(g, e)
    paired_g = {gi for gi, _ in pairs}
    paired_e = {ej for _, ej in pairs}

    # English slice for the j-th English turn: to the next English turn's start
    # (paired or not — the slices partition the book text), else the text end.
    def e_slice(j: int) -> str:
        end = e[j + 1]["goff"] if j + 1 < len(e) else len(text)
        return text[e[j]["goff"]:end].strip()

    def g_ref(i: int) -> dict:
        t = g[i]
        return {"c": t["column"], "n": t["line"], "o": t["offset"]}

    # Reading-order rank of each Stephanus column (from the Greek spine order),
    # so residual one-sided turns from the two languages interleave by column
    # rather than all-Greek-then-all-English within an anchor gap.
    col_rank: dict[str, int] = {}
    for seg in book_segments:
        col_rank.setdefault(seg["column"], len(col_rank))

    turns: list[dict] = []
    gi = ej = 0
    for pgi, pej in pairs + [(len(g), len(e))]:
        # Residuals before this pair: one-sided rows, merged by their column's
        # reading order (Greek before English within the same column, so the
        # citation spine stays ahead of loose English).
        region: list[tuple[int, int, int, dict]] = []
        while gi < pgi:
            if gi not in paired_g:
                region.append((col_rank.get(g[gi]["column"], 1 << 30), 0, gi,
                               {"s": g[gi]["name"], "d": None,
                                "g": g_ref(gi), "e": None, "p": False}))
            gi += 1
        while ej < pej:
            if ej not in paired_e:
                region.append((col_rank.get(e[ej]["column"], 1 << 30), 1, ej,
                               {"s": e[ej]["speaker"], "d": e[ej]["display"],
                                "g": None, "e": e_slice(ej), "p": False}))
            ej += 1
        region.sort(key=lambda r: r[:3])
        turns.extend(r[3] for r in region)
        if pgi < len(g):
            name = g[pgi]["name"] if g[pgi]["name"] is not None else e[pej]["speaker"]
            turns.append({"s": name, "d": e[pej]["display"],
                          "g": g_ref(pgi), "e": e_slice(pej), "p": True})
            gi, ej = pgi + 1, pej + 1

    lead_e = text[:e[0]["goff"]].strip() if e else text.strip()
    flow = {"leadE": lead_e or None, "turns": turns}
    stats = {"g_turns": len(g), "e_turns": len(e), "paired": len(pairs),
             "g_residual": len(g) - len(pairs),
             "e_residual": len(e) - len(pairs),
             "unmapped": unmapped}
    return flow, stats
