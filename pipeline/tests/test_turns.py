import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "pipeline"))

from plato_pipeline import turns


SIGLA = {"ΣΩ.": "Socrates", "ΕΥΘ.": "Euthyphro", "ΙΠ.": "Hippias"}


def _g(column, name):
    return {"column": column, "name": name}


def _e(column, speaker):
    return {"column": column, "speaker": speaker}


# --- siglum normalisation ----------------------------------------------------

def test_base_siglum_strips_dash_and_bracket():
    assert turns.base_siglum("ΣΩ.") == "ΣΩ."
    assert turns.base_siglum("— ΣΩ.") == "ΣΩ."
    assert turns.base_siglum("—ΣΩ.") == "ΣΩ."
    assert turns.base_siglum("—<ΙΠ.") == "ΙΠ."
    assert turns.base_siglum("—") == ""


def test_greek_speaker_maps_dash_to_null_and_reports_unmapped():
    assert turns.greek_speaker("ΣΩ.", SIGLA) == ("Socrates", True)
    assert turns.greek_speaker("— ΣΩ.", SIGLA) == ("Socrates", True)
    assert turns.greek_speaker("—", SIGLA) == (None, True)
    assert turns.greek_speaker("ΧΧ.", SIGLA) == ("ΧΧ.", False)


# --- global pairing (pair_book) ----------------------------------------------

def test_identical_sequences_pair_fully_across_section_boundaries():
    # Perseus files the 3rd turn under 2b while the OCT keeps it in 2a — the
    # exact boundary drift that broke per-section pairing. Global pairing
    # ignores the column entirely for named matches.
    g = [_g("2a", "Euthyphro"), _g("2a", "Socrates"), _g("2a", "Euthyphro")]
    e = [_e("2a", "Euthyphro"), _e("2a", "Socrates"), _e("2b", "Euthyphro")]
    assert turns.pair_book(g, e) == [(0, 0), (1, 1), (2, 2)]


def test_off_by_one_extra_english_turn_is_absorbed():
    # Euthyphro's 232 vs 233: an extra English turn falls out of the LCS; the
    # rest stay paired 1:1.
    g = [_g("2a", "Euthyphro"), _g("2a", "Socrates"), _g("2b", "Euthyphro")]
    e = [_e("2a", "Euthyphro"), _e("2a", "Socrates"),
         _e("2a", "Socrates"),  # duplicate — no Greek counterpart
         _e("2b", "Euthyphro")]
    pairs = turns.pair_book(g, e)
    assert (0, 0) in pairs and (2, 3) in pairs
    assert len(pairs) == 3           # 3 of 3 Greek turns paired
    assert (1, 1) in pairs or (1, 2) in pairs


def test_gap_zip_pairs_dash_turns_between_named_anchors():
    # Named anchors bound a run of unattributed dashes; equal counts zip.
    g = [_g("5c", "Socrates"), _g("5c", None), _g("5d", None), _g("5d", "Hippias")]
    e = [_e("5c", "Socrates"), _e("5c", None), _e("5c", None), _e("5d", "Hippias")]
    assert turns.pair_book(g, e) == [(0, 0), (1, 1), (2, 2), (3, 3)]


def test_unequal_gap_falls_back_to_column_zip():
    # Between anchors the counts differ (3 Greek vs 4 English dashes), so only
    # columns whose counts match pair; the odd column's turns stay residual.
    g = [_g("1a", "Socrates"),
         _g("1b", None), _g("1b", None),   # 1b: 2 dashes
         _g("1c", None),                    # 1c: 1 dash
         _g("1d", "Hippias")]
    e = [_e("1a", "Socrates"),
         _e("1b", None), _e("1b", None),   # 1b: 2 — zips
         _e("1c", None), _e("1c", None),   # 1c: 2 vs 1 — residual
         _e("1d", "Hippias")]
    pairs = turns.pair_book(g, e)
    assert (0, 0) in pairs and (4, 5) in pairs
    assert (1, 1) in pairs and (2, 2) in pairs
    assert len(pairs) == 4  # the 1c turns did not pair


def test_pairs_are_strictly_monotone():
    g = [_g("1a", "Socrates"), _g("1b", "Hippias")]
    e = [_e("1a", "Hippias"), _e("1b", "Socrates")]
    # Crossing name matches (Soc→e1, Hip→e0) can't both survive.
    pairs = turns.pair_book(g, e)
    for (g1, e1), (g2, e2) in zip(pairs, pairs[1:]):
        assert g2 > g1 and e2 > e1


# --- flow construction (build_turn_flow) --------------------------------------

def _seg(column, speakers=None, book=1):
    return {"id": f"{book}:{column}", "book": book, "column": column,
            "speakers": speakers or []}


def _chunk(column, text, turns_=None, book=1):
    return {"id": f"{book}:{column}", "book": book, "column": column,
            "text": text, "turns": turns_ or []}


def test_flow_pairs_and_slices_english_across_chunk_boundaries():
    segs = [
        _seg("2a", [{"line": 1, "offset": 0, "label": "ΕΥΘ."},
                    {"line": 5, "offset": 0, "label": "ΣΩ."}]),
        _seg("2b", [{"line": 2, "offset": 3, "label": "ΕΥΘ."}]),
    ]
    chunks = [
        _chunk("2a", "What is new? Nothing much.",
               [{"offset": 0, "speaker": "Euthyphro", "display": "Euth."},
                {"offset": 13, "speaker": "Socrates", "display": "Soc."}]),
        # Perseus filed the 3rd turn\'s start in 2b; its slice runs to text end.
        _chunk("2b", "Indeed. More words.",
               [{"offset": 8, "speaker": "Euthyphro", "display": "Euth."}]),
    ]
    flow, stats = turns.build_turn_flow(segs, chunks, SIGLA)
    assert stats == {"g_turns": 3, "e_turns": 3, "paired": 3,
                     "g_residual": 0, "e_residual": 0,
                     "e_dropped_empty": 0, "g_folded": 0,
                     "e_folded": 0, "residual_rows": 0, "unmapped": {}}
    assert flow["leadE"] is None
    ts = flow["turns"]
    assert [t["p"] for t in ts] == [True, True, True]
    assert ts[0] == {"s": "Euthyphro", "d": "Euth.",
                     "g": {"c": "2a", "n": 1, "o": 0},
                     "e": "What is new?", "p": True}
    # Socrates\' English slice crosses the 2a/2b chunk boundary (joined text).
    assert ts[1]["e"] == "Nothing much. Indeed."
    assert ts[2] == {"s": "Euthyphro", "d": "Euth.",
                     "g": {"c": "2b", "n": 2, "o": 3},
                     "e": "More words.", "p": True}


def test_flow_leadE_captures_text_before_the_first_turn():
    segs = [_seg("2a", [{"line": 3, "offset": 0, "label": "ΣΩ."}])]
    chunks = [_chunk("2a", "continuation tail. Speech.",
                     [{"offset": 19, "speaker": "Socrates", "display": "Soc."}])]
    flow, _ = turns.build_turn_flow(segs, chunks, SIGLA)
    assert flow["leadE"] == "continuation tail."
    assert flow["turns"][0]["e"] == "Speech."


def test_flow_residuals_group_both_sides_by_column():
    segs = [_seg("2a", [{"line": 1, "offset": 0, "label": "ΣΩ."}]),
            _seg("2b", [{"line": 2, "offset": 0, "label": "—"},
                         {"line": 3, "offset": 0, "label": "—"}]),
            _seg("2c", [{"line": 4, "offset": 0, "label": "ΙΠ."}])]
    chunks = [_chunk("2a", "Mine.",
                     [{"offset": 0, "speaker": "Socrates", "display": "Soc."}]),
              _chunk("2b", "Extra. Again. Third.",
                     [{"offset": 0, "speaker": None, "display": "One"},
                      {"offset": 7, "speaker": None, "display": "Two"},
                      {"offset": 14, "speaker": None, "display": "Three"}]),
              _chunk("2c", "Last.",
                     [{"offset": 0, "speaker": "Hippias", "display": "Hip."}])]
    chunks[1]["markers"] = [{"kind": "paragraph", "n": "", "offset": 3}]
    flow, stats = turns.build_turn_flow(segs, chunks, SIGLA)
    assert stats["paired"] == 2 and stats["g_residual"] == 2
    assert flow["turns"][1] == {
        "s": None, "d": None, "g": {"c": "2b", "n": 2, "o": 0},
        "e": None, "p": False,
        "sub": [{"s": None, "d": "One", "e": "Extra.", "ep": [3]},
                {"s": None, "d": "Two", "e": "Again."},
                {"s": None, "d": "Three", "e": "Third."}],
    }
    assert stats["g_folded"] == 1 and stats["e_folded"] == 3
    assert stats["residual_rows"] == 1


def test_flow_drops_empty_english_slice_before_pairing():
    segs = [_seg("2a", [{"line": 1, "offset": 0, "label": "ΣΩ."}])]
    chunks = [_chunk("2a", "Spoken.",
                     [{"offset": 0, "speaker": "Euthyphro", "display": "Outer"},
                      {"offset": 0, "speaker": "Socrates", "display": "Soc."}])]
    flow, stats = turns.build_turn_flow(segs, chunks, SIGLA)
    assert stats["e_dropped_empty"] == 1
    assert stats["e_turns"] == stats["paired"] == 1
    assert flow["turns"][0]["e"] == "Spoken."


def test_flow_omits_greek_only_column():
    segs = [_seg("2a", [{"line": 1, "offset": 0, "label": "ΣΩ."}]),
            _seg("2b", [{"line": 2, "offset": 0, "label": "—"}])]
    chunks = [_chunk("2a", "Mine.",
                     [{"offset": 0, "speaker": "Socrates", "display": "Soc."}])]
    flow, stats = turns.build_turn_flow(segs, chunks, SIGLA)
    assert len(flow["turns"]) == 1
    assert stats["g_folded"] == 1 and stats["residual_rows"] == 0


def test_flow_folds_english_only_column_into_previous_sub():
    segs = [_seg("2a", [{"line": 1, "offset": 0, "label": "ΣΩ."}])]
    chunks = [_chunk("2a", "Mine.",
                     [{"offset": 0, "speaker": "Socrates", "display": "Soc."}]),
              _chunk("2b", "Extra.",
                     [{"offset": 0, "speaker": "Euthyphro", "display": "Euth."}])]
    flow, stats = turns.build_turn_flow(segs, chunks, SIGLA)
    assert flow["turns"][0]["sub"] == [
        {"s": "Euthyphro", "d": "Euth.", "e": "Extra."}]
    assert stats["e_folded"] == 1


def test_flow_keeps_book_head_english_only_fallback():
    segs = [_seg("2b", [{"line": 2, "offset": 0, "label": "ΣΩ."}])]
    chunks = [_chunk("2a", "Extra.",
                     [{"offset": 0, "speaker": "Euthyphro", "display": "Euth."}]),
              _chunk("2b", "Mine.",
                     [{"offset": 0, "speaker": "Socrates", "display": "Soc."}])]
    flow, stats = turns.build_turn_flow(segs, chunks, SIGLA)
    assert flow["turns"][0]["g"] is None
    assert flow["turns"][0]["e"] == "Extra."
    assert stats["residual_rows"] == 1 and stats["e_folded"] == 0


def test_flow_emits_book_head_greek_only_group_as_a_row():
    # Review finding 3: a Greek-only residual group BEFORE any emitted g-bearing
    # entry must emit its own Greek-bearing row — the reader slices Greek from
    # the first emitted g ref, so folding it would make the 2a Greek
    # unreachable. Greek coverage must start at 2a, not 2b.
    segs = [_seg("2a", [{"line": 1, "offset": 0, "label": "—"}]),
            _seg("2b", [{"line": 2, "offset": 0, "label": "ΣΩ."}])]
    chunks = [_chunk("2b", "Mine.",
                     [{"offset": 0, "speaker": "Socrates", "display": "Soc."}])]
    flow, stats = turns.build_turn_flow(segs, chunks, SIGLA)
    head, paired = flow["turns"]
    assert head == {"s": None, "d": None, "g": {"c": "2a", "n": 1, "o": 0},
                    "e": None, "p": False}
    assert paired["p"] is True and paired["g"]["c"] == "2b"
    assert stats["residual_rows"] == 1 and stats["g_folded"] == 0
    # A LATER Greek-only group (after a g-bearing entry) still folds silently.
    segs2 = segs + [_seg("2c", [{"line": 3, "offset": 0, "label": "—"}])]
    flow2, stats2 = turns.build_turn_flow(segs2, chunks, SIGLA)
    assert len(flow2["turns"]) == 2  # no third row for the 2c dash
    assert stats2["g_folded"] == 1


def test_flow_none_for_a_narrated_book():
    segs = [_seg("327a")]  # no Greek events
    chunks = [_chunk("327a", "I went down yesterday.",
                     [{"offset": 0, "speaker": "Socrates", "display": None}])]
    flow, stats = turns.build_turn_flow(segs, chunks, SIGLA)
    assert flow is None
    assert stats["g_turns"] == 0 and stats["e_turns"] == 1


def test_flow_reports_unmapped_sigla():
    segs = [_seg("2a", [{"line": 1, "offset": 0, "label": "ΧΧ."}])]
    chunks = [_chunk("2a", "Text.", [{"offset": 0, "speaker": "Nobody", "display": None}])]
    _, stats = turns.build_turn_flow(segs, chunks, SIGLA)
    assert stats["unmapped"] == {"ΧΧ.": 1}


# --- B2: paragraph breaks inside dialogue slices (ep) --------------------------

def _pchunk(column, text, paras=(), turns_=(), para_start=False, book=1):
    return {"id": f"{book}:{column}", "book": book, "column": column,
            "text": text, "para_start": para_start,
            "markers": [{"kind": "paragraph", "n": "", "offset": o} for o in paras],
            "turns": list(turns_)}


def test_dialogue_slice_carries_internal_paragraph_breaks_as_ep():
    # A single long speech (one turn) whose English breaks into paragraphs: the
    # interior breaks ride `ep` relative to the stripped slice; a slice with no
    # interior break omits the key.
    segs = [_seg("2a", [{"line": 1, "offset": 0, "label": "ΣΩ."},
                        {"line": 9, "offset": 0, "label": "ΕΥΘ."}])]
    chunks = [_pchunk(
        "2a", "First part. Second part. Third part. Reply.",
        paras=[12, 24],  # "Second part." @12, "Third part." @24
        turns_=[{"offset": 0, "speaker": "Socrates", "display": "Soc."},
                {"offset": 37, "speaker": "Euthyphro", "display": "Euth."}])]
    flow, _ = turns.build_turn_flow(segs, chunks, SIGLA)
    soc, euth = flow["turns"]
    assert soc["e"] == "First part. Second part. Third part."
    assert soc["ep"] == [12, 24]
    assert euth["e"] == "Reply."
    assert "ep" not in euth


# --- B3: narrated-work paragraph flow (build_para_flow) ------------------------

def _pseg(column, n, book=1):
    return {"id": f"{book}:{column}", "book": book, "column": column,
            "lines": [{"n": n, "text": "x"}], "speakers": []}


def test_para_flow_basic_row_cutting():
    # Two sections, each opening a paragraph (para_start) -> one row per column,
    # English cut exactly at the paragraph boundary, no lead-in.
    segs = [_pseg("2a", 1), _pseg("2b", 5)]
    chunks = [_pchunk("2a", "Alpha only.", para_start=True),
              _pchunk("2b", "Beta only.", para_start=True)]
    flow, stats = turns.build_para_flow(segs, chunks)
    assert flow["kind"] == "para"
    assert flow["leadE"] is None
    assert flow["turns"] == [
        {"s": None, "d": None, "g": {"c": "2a", "n": 1, "o": 0},
         "e": "Alpha only.", "p": False},
        {"s": None, "d": None, "g": {"c": "2b", "n": 5, "o": 0},
         "e": "Beta only.", "p": False},
    ]
    assert stats == {"rows": 2, "paragraphs": 2, "sections": 2}


def test_para_flow_merges_same_column_paragraphs_with_ep():
    # One section, opening a paragraph with two interior breaks -> one row whose
    # internal breaks ride ep (all three paragraphs share column 2a).
    segs = [_pseg("2a", 1)]
    chunks = [_pchunk("2a", "A0 first. A1 second. A2 third.",
                      paras=[10, 21], para_start=True)]
    flow, stats = turns.build_para_flow(segs, chunks)
    assert flow["leadE"] is None
    assert len(flow["turns"]) == 1
    row = flow["turns"][0]
    assert row["g"] == {"c": "2a", "n": 1, "o": 0}
    assert row["e"] == "A0 first. A1 second. A2 third."
    assert row["ep"] == [10, 21]
    assert stats == {"rows": 1, "paragraphs": 3, "sections": 1}


def test_para_flow_snaps_forward_on_latter_half_break():
    # 3b starts mid-paragraph (no para_start) and its paragraph break sits in the
    # latter half; the next paragraph is in 3d (not 3c), so the row snaps forward
    # to the free column 3c.
    segs = [_pseg("3a", 1), _pseg("3b", 10), _pseg("3c", 20), _pseg("3d", 30)]
    chunks = [_pchunk("3a", "Book opening line.", para_start=True),
              _pchunk("3b", "contcontco Bnewpara!!", paras=[11]),
              _pchunk("3d", "Delta open.", para_start=True)]
    flow, _ = turns.build_para_flow(segs, chunks)
    assert [r["g"]["c"] for r in flow["turns"]] == ["3a", "3c", "3d"]
    assert flow["turns"][1]["g"]["n"] == 20


def test_para_flow_collision_falls_back_to_containing_column():
    # Same latter-half break in 3b, but the next paragraph already lives in 3c,
    # so snapping forward would collide — keep the containing column 3b.
    segs = [_pseg("3a", 1), _pseg("3b", 10), _pseg("3c", 20)]
    chunks = [_pchunk("3a", "Book opening line.", para_start=True),
              _pchunk("3b", "contcontco Bnewpara!!", paras=[11]),
              _pchunk("3c", "Gamma.", para_start=True)]
    flow, _ = turns.build_para_flow(segs, chunks)
    assert [r["g"]["c"] for r in flow["turns"]] == ["3a", "3b", "3c"]


def test_para_flow_english_only_section_snaps_to_preceding_column():
    # 4x has no Greek segment: its paragraph snaps back to the preceding Greek
    # column 4a and, colliding with the row already anchored there, merges in.
    segs = [_pseg("4a", 1)]
    chunks = [_pchunk("4a", "Alpha body here.", para_start=True),
              _pchunk("4x", "Ex body.", para_start=True)]
    flow, stats = turns.build_para_flow(segs, chunks)
    assert len(flow["turns"]) == 1
    assert flow["turns"][0]["g"]["c"] == "4a"
    assert "ep" in flow["turns"][0]
    assert stats["sections"] == 1


def test_para_flow_english_only_snap_crosses_greek_only_columns():
    # Review finding 1: Greek spine 4a,4b,4c but English chunks only at 4a and
    # the english-only 4d. The 4d paragraph must anchor to 4c — the truly
    # nearest preceding Greek column by Stephanus order — NOT to 4a (the last
    # Greek column that happened to have an English chunk), which would stretch
    # the Greek slice across 4b-4c beside the wrong English.
    segs = [_pseg("4a", 1), _pseg("4b", 10), _pseg("4c", 20)]
    chunks = [_pchunk("4a", "Alpha body text here.", para_start=True),
              _pchunk("4d", "English-only paragraph.", para_start=True)]
    flow, stats = turns.build_para_flow(segs, chunks)
    assert [r["g"]["c"] for r in flow["turns"]] == ["4a", "4c"]
    assert flow["turns"][1]["g"]["n"] == 20
    assert flow["turns"][1]["e"] == "English-only paragraph."
    assert stats["rows"] == 2


def test_para_flow_seeds_book_start_as_a_row_at_offset_zero():
    # The first chunk opens the book's first paragraph even without a flagged
    # para_start (its <p> fired before the section existed): offset 0 is seeded
    # as a row start, so the opening prose is its own row with no lead-in blob —
    # its later interior break rides ep.
    segs = [_pseg("2a", 1), _pseg("2b", 5)]
    chunks = [_pchunk("2a", "Opening prose here. More text.", paras=[20]),
              _pchunk("2b", "Beta only.", para_start=True)]
    flow, stats = turns.build_para_flow(segs, chunks)
    assert flow["leadE"] is None
    assert [r["g"]["c"] for r in flow["turns"]] == ["2a", "2b"]
    assert flow["turns"][0]["e"] == "Opening prose here. More text."
    assert flow["turns"][0]["ep"] == [20]
    assert stats == {"rows": 2, "paragraphs": 3, "sections": 2}


def test_para_flow_none_when_under_two_paragraphs():
    # One real paragraph signal (a single interior marker, no para_start) is
    # below threshold BEFORE the book-start seed, so no flow.
    segs = [_pseg("2a", 1)]
    chunks = [_pchunk("2a", "One break only here.", paras=[4])]
    flow, stats = turns.build_para_flow(segs, chunks)
    assert flow is None
    assert stats == {"rows": 0, "paragraphs": 1, "sections": 1}


def test_para_flow_carries_embedded_turns_as_et():
    segs = [_pseg("5a", 1), _pseg("5b", 10)]
    chunks = [_pchunk("5a", "Zero one two three.", para_start=True,
                      turns_=[{"offset": 5, "speaker": "Socrates",
                               "display": "Soc."}]),
              _pchunk("5b", "Beta.", para_start=True)]
    flow, _ = turns.build_para_flow(segs, chunks)
    assert flow["turns"][0]["et"] == [{"o": 5, "s": "Socrates", "d": "Soc."}]
    assert "et" not in flow["turns"][1]


# --- coverage + non-empty invariants (integration) -----------------------------

def _assert_flow_invariants(flow, segs):
    """Every emitted English slice (e and sub[].e) is non-empty; the g-ref chain
    covers the Greek spine: first g ref is the book's first column and refs are
    monotone in spine order (slice-to-next-g then covers every column)."""
    spine: list[str] = []
    for s in segs:
        if s["column"] not in spine:
            spine.append(s["column"])
    rank = {c: i for i, c in enumerate(spine)}
    g_cols = [t["g"]["c"] for t in flow["turns"] if t.get("g")]
    assert g_cols, "flow carries no Greek refs"
    assert g_cols[0] == spine[0], f"first g ref {g_cols[0]} != {spine[0]}"
    ranks = [rank[c] for c in g_cols]
    assert all(b >= a for a, b in zip(ranks, ranks[1:])), "g refs not monotone"
    for t in flow["turns"]:
        if t.get("e") is not None:
            assert t["e"].strip(), "empty English slice emitted"
        for sub in t.get("sub", []):
            assert sub["e"].strip(), "empty sub English slice emitted"


def test_invariants_hold_for_a_narrated_para_flow():
    segs = [_pseg("2a", 1), _pseg("2b", 5), _pseg("2c", 9)]
    chunks = [_pchunk("2a", "Alpha body text goes on.", para_start=True),
              _pchunk("2b", "Beta body continues.", paras=[10]),
              _pchunk("2d", "English-only bit.", para_start=True)]
    flow, _ = turns.build_para_flow(segs, chunks)
    _assert_flow_invariants(flow, segs)


def test_invariants_hold_for_a_dash_run_turn_flow():
    # Head Greek-only dash (2a), a named pair (2b), then an unequal dash run in
    # 2c (2 Greek vs 1 English -> a both-sides residual row).
    segs = [_seg("2a", [{"line": 1, "offset": 0, "label": "—"}]),
            _seg("2b", [{"line": 1, "offset": 0, "label": "ΣΩ."}]),
            _seg("2c", [{"line": 1, "offset": 0, "label": "—"},
                        {"line": 4, "offset": 2, "label": "—"}])]
    chunks = [_chunk("2b", "Sok speech.",
                     [{"offset": 0, "speaker": "Socrates", "display": "Soc."}]),
              _chunk("2c", "One.",
                     [{"offset": 0, "speaker": None, "display": None}])]
    flow, stats = turns.build_turn_flow(segs, chunks, SIGLA)
    _assert_flow_invariants(flow, segs)
    assert stats["residual_rows"] == 2  # head 2a row + both-sides 2c row
