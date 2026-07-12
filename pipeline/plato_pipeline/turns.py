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


def collect_english_turns(
    book_chunks: list[dict],
) -> tuple[str, list[dict], list[int]]:
    """Concatenate the book's chunk prose (single-space joined, in document
    order) and rebase each chunk's turn offsets AND paragraph-marker offsets
    into the joined text. Returns (text, turns, paras) with turns as
    {column, goff, speaker, display} and paras a sorted list of paragraph-start
    offsets in the joined text."""
    parts: list[str] = []
    turns: list[dict] = []
    paras: list[int] = []
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
        for m in c.get("markers", []):
            if m.get("kind") == "paragraph":
                paras.append(pos + m["offset"])
        parts.append(t)
        pos += len(t)
    return "".join(parts), turns, paras


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
    text, e, paras = collect_english_turns(book_chunks)
    if not g:
        return None, {"g_turns": 0, "e_turns": len(e), "paired": 0,
                      "g_residual": 0, "e_residual": len(e),
                      "unmapped": unmapped}
    pairs = pair_book(g, e)
    paired_g = {gi for gi, _ in pairs}
    paired_e = {ej for _, ej in pairs}

    # English slice for the j-th English turn: to the next English turn's start
    # (paired or not — the slices partition the book text), else the text end.
    # `ep` are the paragraph-break offsets interior to that slice, relative to
    # the stripped slice (long monologues, e.g. Timaeus, break internally); the
    # caller omits the field when empty for back-compat.
    def e_slice(j: int) -> str:
        end = e[j + 1]["goff"] if j + 1 < len(e) else len(text)
        return text[e[j]["goff"]:end].strip()

    def e_ep(j: int) -> list[int]:
        start = e[j]["goff"]
        end = e[j + 1]["goff"] if j + 1 < len(e) else len(text)
        raw = text[start:end]
        lshift = len(raw) - len(raw.lstrip())
        slen = len(raw.strip())
        out: list[int] = []
        for p in paras:
            if start <= p < end:
                rel = p - start - lshift
                if 0 < rel < slen and (not out or out[-1] != rel):
                    out.append(rel)
        return out

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
                                "g": None, "e": e_slice(ej), "p": False,
                                **({"ep": ep} if (ep := e_ep(ej)) else {})}))
            ej += 1
        region.sort(key=lambda r: r[:3])
        turns.extend(r[3] for r in region)
        if pgi < len(g):
            name = g[pgi]["name"] if g[pgi]["name"] is not None else e[pej]["speaker"]
            turns.append({"s": name, "d": e[pej]["display"],
                          "g": g_ref(pgi), "e": e_slice(pej), "p": True,
                          **({"ep": ep} if (ep := e_ep(pej)) else {})})
            gi, ej = pgi + 1, pej + 1

    lead_e = text[:e[0]["goff"]].strip() if e else text.strip()
    flow = {"leadE": lead_e or None, "turns": turns}
    stats = {"g_turns": len(g), "e_turns": len(e), "paired": len(pairs),
             "g_residual": len(g) - len(pairs),
             "e_residual": len(e) - len(pairs),
             "unmapped": unmapped}
    return flow, stats


# ── Narrated-work paragraph flow ──────────────────────────────────────────────

def build_para_flow(book_segments: list[dict], book_chunks: list[dict],
                    ) -> tuple[dict | None, dict]:
    """A paragraph-anchored prose flow for a narrated book (no Greek turns).

    Returns (flow, stats). The English is cut into rows at its paragraph breaks;
    each row's Greek anchor is a whole Stephanus column (o:0). Because the Greek
    (TLG) has no paragraph structure — only sections are cut points — a break
    falling mid-section is anchored to the NEAREST section boundary: when the
    paragraph starts in the latter half of its section's English text we snap the
    row's Greek forward to the next column (John's skew mitigation), unless the
    next column is already claimed by the following paragraph (collision → keep
    the containing column). A break in an English-only section (no Greek segment)
    snaps to the nearest preceding Greek column, merging into the previous row on
    collision. Consecutive paragraphs resolving to the same column merge into one
    row whose internal breaks ride `ep`. Embedded English speaker turns are
    carried per row as `et` intra-row block markers (they are NOT row anchors —
    the Greek has no counterpart events).

        flow = {"kind": "para", "leadE": str|None,
                "turns": [{"s": None, "d": None, "g": {"c","n","o":0},
                           "e": slice, "p": False, "ep": [...], "et": [...]}]}
        stats = {"rows", "paragraphs", "sections"}

    A book with < 2 paragraph markers yields (None, stats): too little to reflow,
    so the reader keeps its section rows.
    """
    # Join the book prose exactly as collect_english_turns does, rebasing each
    # chunk's paragraph offsets, English speaker turns, and column span into the
    # one book-level coordinate system.
    parts: list[str] = []
    spans: list[tuple[int, int, str]] = []   # (start, end, column) per chunk
    paras: list[int] = []
    ev: list[dict] = []                       # embedded english.turns events
    pos = 0
    for c in book_chunks:
        t = c.get("text", "")
        if not t:
            continue
        if parts:
            parts.append(" ")
            pos += 1
        # A chunk whose text begins at a paragraph boundary (para_start) is a
        # clean row start at its offset 0 — the section boundary coincides with
        # the paragraph, so the segment path drops the marker but the flow keeps
        # it. Its interior `<p>` breaks follow as ordinary markers.
        if c.get("para_start"):
            paras.append(pos)
        for m in c.get("markers", []):
            if m.get("kind") == "paragraph":
                paras.append(pos + m["offset"])
        for tr in c.get("turns", []):
            ev.append({"goff": pos + tr["offset"], "s": tr["speaker"],
                       "d": tr["display"]})
        spans.append((pos, pos + len(t), c["column"]))
        parts.append(t)
        pos += len(t)
    text = "".join(parts)

    # Greek column inventory: reading order + the first Greek line n per column.
    col_line: dict[str, int] = {}
    col_order: list[str] = []
    for seg in book_segments:
        col = seg["column"]
        if col not in col_line:
            lines = seg.get("lines", [])
            col_line[col] = lines[0]["n"] if lines else 1
            col_order.append(col)
    col_rank = {col: i for i, col in enumerate(col_order)}

    # Fallback threshold on the REAL paragraph signals (interior markers +
    # para_start boundaries), before seeding the book-start below: too few to
    # reflow → keep the section rows.
    if len(paras) < 2 or not col_order:
        return None, {"rows": 0, "paragraphs": len(paras),
                      "sections": len(col_order)}

    # The book's first chunk begins the book's first paragraph — but its opening
    # `<p>` fires before the section milestone exists (no chunk yet), so it is
    # never flagged. Seed offset 0 as a paragraph start so the opening prose is a
    # row rather than an unbroken lead-in.
    if spans and paras[0] != 0:
        paras.insert(0, 0)

    stats = {"rows": 0, "paragraphs": len(paras), "sections": len(col_order)}

    def span_index(off: int) -> int:
        """Index of the chunk span containing `off` (or the last span starting
        at/before it — a paragraph offset is always interior to a chunk, never
        in the single-space gap between two)."""
        found = 0
        for k, (s, e_, _) in enumerate(spans):
            if s <= off < e_:
                return k
            if s > off:
                break
            found = k
        return found

    # The nearest Greek column at/before each chunk span (English-only sections
    # snap to it).
    greek_before: list[str | None] = []
    last_greek: str | None = None
    for _, _, col in spans:
        if col in col_line:
            last_greek = col
        greek_before.append(last_greek)

    # Run-length group the paragraphs by their containing chunk column.
    groups: list[dict] = []
    for p in paras:
        k = span_index(p)
        col = spans[k][2]
        if groups and groups[-1]["col"] == col:
            groups[-1]["paras"].append(p)
        else:
            groups.append({"col": col, "span_idx": k, "paras": [p]})

    def anchor_for(gi: int) -> str:
        grp = groups[gi]
        col = grp["col"]
        if col in col_line:
            first = grp["paras"][0]
            s, e_, _ = spans[grp["span_idx"]]
            # Latter-half break → snap forward one Greek column, unless that
            # column is where the next paragraph group already sits (collision).
            if e_ > s and (first - s) / (e_ - s) > 0.5:
                r = col_rank[col] + 1
                if r < len(col_order):
                    nxt = col_order[r]
                    next_cc = groups[gi + 1]["col"] if gi + 1 < len(groups) else None
                    if nxt != next_cc:
                        return nxt
            return col
        # English-only section: nearest preceding Greek column (first Greek
        # column as a last resort for an English-only lead).
        gb = greek_before[grp["span_idx"]]
        return gb if gb is not None else col_order[0]

    # Merge consecutive groups resolving to the same anchor (or a backward one —
    # keeps anchors monotone) into one row.
    rows: list[dict] = []
    for gi in range(len(groups)):
        a = anchor_for(gi)
        if rows and col_rank.get(a, -1) <= col_rank.get(rows[-1]["col"], -1):
            rows[-1]["paras"].extend(groups[gi]["paras"])
        else:
            rows.append({"col": a, "paras": list(groups[gi]["paras"])})

    row_starts = [r["paras"][0] for r in rows]
    out_rows: list[dict] = []
    for idx, r in enumerate(rows):
        start = r["paras"][0]
        end = row_starts[idx + 1] if idx + 1 < len(rows) else len(text)
        raw = text[start:end]
        lshift = len(raw) - len(raw.lstrip())
        slice_txt = raw.strip()
        slen = len(slice_txt)
        ep: list[int] = []
        for p in r["paras"][1:]:
            rel = p - start - lshift
            if 0 < rel < slen and (not ep or ep[-1] != rel):
                ep.append(rel)
        et: list[dict] = []
        for e_ev in ev:
            if start <= e_ev["goff"] < end:
                rel = e_ev["goff"] - start - lshift
                if 0 <= rel < slen:
                    et.append({"o": rel, "s": e_ev["s"], "d": e_ev["d"]})
        col = r["col"]
        row = {"s": None, "d": None,
               "g": {"c": col, "n": col_line[col], "o": 0},
               "e": slice_txt, "p": False}
        if ep:
            row["ep"] = ep
        if et:
            row["et"] = et
        out_rows.append(row)

    lead_e = text[:row_starts[0]].strip()
    flow = {"kind": "para", "leadE": lead_e or None, "turns": out_rows}
    stats["rows"] = len(out_rows)
    return flow, stats
