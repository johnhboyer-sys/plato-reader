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
                     "e": "What is new?", "p": True,
                     "es": [{"o": 0, "c": "2a"}]}
    # Socrates\' English slice crosses the 2a/2b chunk boundary (joined text).
    assert ts[1]["e"] == "Nothing much. Indeed."
    assert ts[2] == {"s": "Euthyphro", "d": "Euth.",
                     "g": {"c": "2b", "n": 2, "o": 3},
                     "e": "More words.", "p": True}


def test_flow_leadE_preserved_when_first_turn_is_not_the_split_opener():
    # The prepend (above) fires only when the first Greek turn pairs to the FIRST
    # English event — i.e. the unlabeled head really is that speech's opening.
    # Here the first English event is a DIFFERENT speaker with no Greek match (an
    # unpaired residual), so the Greek turn pairs to the SECOND event; the
    # unlabeled opening is not part of that speech and must stay in leadE.
    segs = [_seg("2a", [{"line": 3, "offset": 0, "label": "ΣΩ."}])]
    chunks = [_chunk("2a", "Unlabeled opening. Interject here. Socrates now.",
                     [{"offset": 19, "speaker": "Euthyphro", "display": "Euth."},
                      {"offset": 34, "speaker": "Socrates", "display": "Soc."}])]
    flow, _ = turns.build_turn_flow(segs, chunks, SIGLA)
    assert flow["leadE"] == "Unlabeled opening."
    assert flow["turns"][0].get("g") is None      # unpaired English residual
    assert flow["turns"][1]["e"] == "Socrates now."


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
        "sub": [{"s": None, "d": "One", "e": "Extra.", "ep": [3],
                 "es": [{"o": 0, "c": "2b"}]},
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
    # The folded speech opens section 2b, so it carries that section start as
    # its own `es` — the reader hangs the 2b citation beside this sub-speech
    # rather than on the parent row's top edge.
    assert flow["turns"][0]["sub"] == [
        {"s": "Euthyphro", "d": "Euth.", "e": "Extra.",
         "es": [{"o": 0, "c": "2b"}]}]
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


def test_flow_head_english_only_columns_get_section_anchored_rows():
    # Lysis shape: a narrated opening whose Greek carries NO turn events, while
    # Perseus marks the English speeches. Each head English-only column group
    # must anchor to the segment spine ({column, first line, o:0}) — NOT lump
    # into one g:null mega-row beside a separate Greek-only wall.
    segs = [_seg("203a"), _seg("203b"),
            _seg("204a", [{"line": 5, "offset": 0, "label": "ΣΩ."}])]
    chunks = [_chunk("203a", "I was making my way. First said.",
                     [{"offset": 0, "speaker": None, "display": None},
                      {"offset": 21, "speaker": None, "display": None}]),
              _chunk("203b", "Second said.",
                     [{"offset": 0, "speaker": None, "display": None}]),
              _chunk("204a", "Mine.",
                     [{"offset": 0, "speaker": "Socrates", "display": "Soc."}])]
    flow, stats = turns.build_turn_flow(segs, chunks, SIGLA)
    r203a, r203b, paired = flow["turns"]
    assert r203a["g"] == {"c": "203a", "n": 1, "o": 0}
    assert r203a["e"] is None and r203a["p"] is False
    assert [s["e"] for s in r203a["sub"]] == ["I was making my way.",
                                              "First said."]
    assert r203b["g"]["c"] == "203b"
    assert [s["e"] for s in r203b["sub"]] == ["Second said."]
    assert paired["p"] is True and paired["g"]["c"] == "204a"
    assert stats["residual_rows"] == 2 and stats["e_folded"] == 3
    _assert_flow_invariants(flow, segs)


def test_flow_head_greek_only_and_english_only_columns_coexist():
    # Both head shapes at once, column order governing: an English-only group
    # at 2a (no Greek events there; 2 turns vs 1 Greek dash → no gap/column
    # zip, so both sides stay residual), a Greek-only dash group at 2b, then
    # the first pair at 2c. Anchors must come out monotone: 2a, 2b, 2c.
    segs = [_seg("2a"),
            _seg("2b", [{"line": 1, "offset": 0, "label": "—"}]),
            _seg("2c", [{"line": 1, "offset": 0, "label": "ΣΩ."}])]
    chunks = [_chunk("2a", "Narration bit. Second bit.",
                     [{"offset": 0, "speaker": None, "display": None},
                      {"offset": 15, "speaker": None, "display": None}]),
              _chunk("2c", "Mine.",
                     [{"offset": 0, "speaker": "Socrates", "display": "Soc."}])]
    flow, _ = turns.build_turn_flow(segs, chunks, SIGLA)
    assert [t["g"]["c"] for t in flow["turns"] if t.get("g")] == \
        ["2a", "2b", "2c"]
    assert [s["e"] for s in flow["turns"][0]["sub"]] == \
        ["Narration bit.", "Second bit."]
    assert flow["turns"][1]["e"] is None and "sub" not in flow["turns"][1]
    _assert_flow_invariants(flow, segs)


def test_flow_mid_book_english_only_column_gets_section_anchored_row():
    # A narrated stretch mid-book (Protagoras' recounting): English-only
    # speeches in 2b, between pairs at 2a and 2c, anchor to 2b's segment
    # instead of folding into the 2a row's sub.
    segs = [_seg("2a", [{"line": 1, "offset": 0, "label": "ΣΩ."}]),
            _seg("2b"),
            _seg("2c", [{"line": 1, "offset": 0, "label": "ΣΩ."}])]
    chunks = [_chunk("2a", "First.",
                     [{"offset": 0, "speaker": "Socrates", "display": "Soc."}]),
              _chunk("2b", "He said. She said.",
                     [{"offset": 0, "speaker": None, "display": None},
                      {"offset": 9, "speaker": None, "display": None}]),
              _chunk("2c", "Last.",
                     [{"offset": 0, "speaker": "Socrates", "display": "Soc."}])]
    flow, _ = turns.build_turn_flow(segs, chunks, SIGLA)
    a, b, c = flow["turns"]
    assert a["p"] is True and "sub" not in a
    assert b["g"] == {"c": "2b", "n": 1, "o": 0} and b["p"] is False
    assert [s["e"] for s in b["sub"]] == ["He said.", "She said."]
    assert c["p"] is True and c["g"]["c"] == "2c"
    _assert_flow_invariants(flow, segs)


def test_flow_same_column_english_only_group_still_folds():
    # An English-only residual in the SAME column as the previous g ref cannot
    # anchor (not strictly after it) — it folds into that row's sub, exactly
    # the previous behavior.
    segs = [_seg("2a", [{"line": 1, "offset": 0, "label": "ΣΩ."}])]
    chunks = [_chunk("2a", "Mine. Extra.",
                     [{"offset": 0, "speaker": "Socrates", "display": "Soc."},
                      {"offset": 6, "speaker": None, "display": None}])]
    flow, stats = turns.build_turn_flow(segs, chunks, SIGLA)
    assert len(flow["turns"]) == 1
    assert flow["turns"][0]["sub"] == [{"s": None, "d": None, "e": "Extra."}]
    assert stats["e_folded"] == 1


def test_flow_attaches_leadE_to_book_head_greek_only_row():
    # Laws shape: the book's opening speech is unlabeled in the English TEI
    # (no turn event), so it lands in leadE — while the Greek opens WITH a turn
    # event. The head Greek-only row must absorb leadE as its English (with
    # interior paragraph breaks as ep) instead of letting its own translation
    # float above it as a lead row.
    segs = [_seg("2a", [{"line": 1, "offset": 0, "label": "—"}]),
            _seg("2b", [{"line": 2, "offset": 0, "label": "ΣΩ."}])]
    chunks = [_pchunk("2a", "Open one. Open two.", paras=[10]),
              _pchunk("2b", "Mine.",
                      turns_=[{"offset": 0, "speaker": "Socrates",
                               "display": "Soc."}])]
    flow, stats = turns.build_turn_flow(segs, chunks, SIGLA)
    assert flow["leadE"] is None
    head = flow["turns"][0]
    assert head["g"]["c"] == "2a"
    assert head["e"] == "Open one. Open two."
    assert head["ep"] == [10]
    assert head["p"] is False
    # A dash head (unattributed in the Greek too) stays label-less.
    assert head["s"] is None and head["d"] is None
    assert flow["turns"][1]["p"] is True
    # Stats are untouched by the attachment (it is presentational).
    assert stats["g_turns"] == 2 and stats["paired"] == 1


def test_flow_leadE_attach_labels_head_row_from_observed_displays():
    # John's request (Laws): the leadE-attached head row carries the speaker
    # label from the GREEK side, displayed with the form the translation uses
    # for that speaker elsewhere in the work (data-driven, not invented).
    segs = [_seg("1a", [{"line": 1, "offset": 0, "label": "ΣΩ."}]),
            _seg("1b", [{"line": 1, "offset": 0, "label": "ΕΥΘ."}]),
            _seg("1c", [{"line": 1, "offset": 0, "label": "ΣΩ."}])]
    chunks = [_chunk("1a", "Opening speech."),
              _chunk("1b", "Second.",
                     [{"offset": 0, "speaker": "Euthyphro", "display": "Euth."}]),
              _chunk("1c", "Third.",
                     [{"offset": 0, "speaker": "Socrates", "display": "Soc."}])]
    flow, _ = turns.build_turn_flow(segs, chunks, SIGLA)
    head = flow["turns"][0]
    assert head["g"]["c"] == "1a" and head["p"] is False
    assert head["s"] == "Socrates"
    assert head["e"] == "Opening speech."
    assert head["d"] == "Soc."          # borrowed from the 1c English turn
    assert flow["leadE"] is None
    # Non-head rows keep their own displays untouched.
    assert flow["turns"][1]["d"] == "Euth."


def test_flow_leadE_attach_leaves_d_null_for_unobserved_speaker():
    # The head Greek speaker (Hippias) never appears in the English turns —
    # no display exists to borrow, so d stays null (em-dash fallback).
    segs = [_seg("1a", [{"line": 1, "offset": 0, "label": "ΙΠ."}]),
            _seg("1b", [{"line": 1, "offset": 0, "label": "ΕΥΘ."}])]
    chunks = [_chunk("1a", "Opening speech."),
              _chunk("1b", "Second.",
                     [{"offset": 0, "speaker": "Euthyphro", "display": "Euth."}])]
    flow, _ = turns.build_turn_flow(segs, chunks, SIGLA)
    head = flow["turns"][0]
    assert head["s"] == "Hippias" and head["e"] == "Opening speech."
    assert head["d"] is None


def test_speaker_displays_prefers_most_frequent_form():
    chunks = [
        _chunk("1a", "x", [{"offset": 0, "speaker": "Athenian", "display": "Athen."}]),
        _chunk("1b", "x", [{"offset": 0, "speaker": "Athenian", "display": "Ath."},
                           {"offset": 0, "speaker": "Athenian", "display": "Ath."},
                           {"offset": 0, "speaker": None, "display": "Ghost."},
                           {"offset": 0, "speaker": "Clinias", "display": None}]),
    ]
    assert turns.speaker_displays(chunks) == {"Athenian": "Ath."}


def test_flow_prepends_unlabeled_opener_to_split_opening_speech():
    # Laws V/X/XI/XII shape: the English TEI leaves the book's opening speech
    # unlabeled (-> leadE) but labels a LATER continuation by the same speaker,
    # and that first labelled English event pairs with the first Greek turn.
    # The Greek opening (726a = "Let everyone who has just heard…") must render
    # beside its OWN translation, the unlabeled head — NOT the continuation.
    # So the head is prepended as the row's leading paragraph and leadE empties.
    # (Regression: previously leadE kept the opener while the row showed the
    # continuation, misaligning the parallel text.)
    segs = [_seg("2a", [{"line": 3, "offset": 0, "label": "ΣΩ."}])]
    chunks = [_chunk("2a", "continuation tail. Speech.",
                     [{"offset": 19, "speaker": "Socrates", "display": "Soc."}])]
    flow, _ = turns.build_turn_flow(segs, chunks, SIGLA)
    assert flow["leadE"] is None
    assert flow["turns"][0]["p"] is True
    assert flow["turns"][0]["e"] == "continuation tail.Speech."
    assert flow["turns"][0]["ep"] == [18]   # paragraph break after the head


def test_flow_prepended_opener_shifts_continuation_paragraphs():
    # As above, but the labelled continuation itself carries a paragraph break;
    # its offset must shift right by the prepended head's length, and the head
    # boundary becomes its own break.
    segs = [_seg("2a", [{"line": 3, "offset": 0, "label": "ΣΩ."}])]
    chunk = {"id": "1:2a", "book": 1, "column": "2a",
             "text": "Head opener. First para. Second para.",
             "turns": [{"offset": 13, "speaker": "Socrates", "display": "Soc."}],
             "markers": [{"kind": "paragraph", "offset": 25}]}
    flow, _ = turns.build_turn_flow([segs[0]], [chunk], SIGLA)
    assert flow["leadE"] is None
    assert flow["turns"][0]["e"] == "Head opener.First para. Second para."
    # head boundary (12) + the continuation's own break (12) shifted by len(head)
    assert flow["turns"][0]["ep"] == [12, 24]


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

def _pchunk(column, text, paras=(), turns_=(), para_start=False, book=1,
            speeches=()):
    """`speeches` are (start, end) offset pairs for top-level spoken runs, the
    markers stage1 emits alongside the paragraph ones (spine mode reads them)."""
    markers = [{"kind": "paragraph", "n": "", "offset": o} for o in paras]
    for start, end in speeches:
        markers.append({"kind": "speech", "n": "", "offset": start})
        markers.append({"kind": "speech-end", "n": "", "offset": end})
    markers.sort(key=lambda m: m["offset"])
    return {"id": f"{book}:{column}", "book": book, "column": column,
            "text": text, "para_start": para_start,
            "markers": markers,
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


def test_dialogue_section_starts_include_matching_opening_and_omit_when_empty():
    segs = [_seg("181e", [{"line": 1, "offset": 0, "label": "ΣΩ."},
                          {"line": 2, "offset": 0, "label": "ΕΥΘ."}])]
    chunks = [_chunk(
        "181e", "First. Reply.",
        [{"offset": 0, "speaker": "Socrates", "display": "Soc."},
         {"offset": 7, "speaker": "Euthyphro", "display": "Euth."}])]
    flow, _ = turns.build_turn_flow(segs, chunks, SIGLA)
    first, reply = flow["turns"]
    assert first["es"] == [{"o": 0, "c": "181e"}]
    assert "es" not in reply


def test_dialogue_section_starts_span_laches_like_speech():
    segs = [_seg("181e", [{"line": 1, "offset": 0, "label": "ΣΩ."}]),
            _seg("182a"), _seg("182b"), _seg("182c"), _seg("182d")]
    chunks = [
        _chunk("181e", "Alpha",
               [{"offset": 0, "speaker": "Socrates", "display": "Soc."}]),
        _chunk("182a", "Bravo"),
        _chunk("182b", "Charlie"),
        _chunk("182c", "Delta"),
        _chunk("182d", "Echo"),
    ]
    flow, _ = turns.build_turn_flow(segs, chunks, SIGLA)
    assert flow["turns"][0]["e"] == "Alpha Bravo Charlie Delta Echo"
    assert flow["turns"][0]["es"] == [
        {"o": 0, "c": "181e"},
        {"o": 6, "c": "182a"},
        {"o": 12, "c": "182b"},
        {"o": 20, "c": "182c"},
        {"o": 26, "c": "182d"},
    ]


def test_dialogue_section_starts_rebase_after_lstrip():
    segs = [_seg("181e", [{"line": 1, "offset": 0, "label": "ΣΩ."}]),
            _seg("182a")]
    chunks = [
        _chunk("181e", "  Alpha",
               [{"offset": 0, "speaker": "Socrates", "display": "Soc."}]),
        _chunk("182a", "Beta"),
    ]
    flow, _ = turns.build_turn_flow(segs, chunks, SIGLA)
    assert flow["turns"][0]["e"] == "Alpha Beta"
    assert flow["turns"][0]["es"] == [
        {"o": 0, "c": "181e"},
        {"o": 6, "c": "182a"},
    ]


def test_dialogue_section_starts_deduplicate_repeated_column_chunks():
    segs = [_seg("181e", [{"line": 1, "offset": 0, "label": "ΣΩ."}])]
    chunks = [
        _chunk("181e", "Alpha",
               [{"offset": 0, "speaker": "Socrates", "display": "Soc."}]),
        _chunk("181e", "Beta"),
    ]
    flow, _ = turns.build_turn_flow(segs, chunks, SIGLA)
    assert flow["turns"][0]["e"] == "Alpha Beta"
    assert flow["turns"][0]["es"] == [{"o": 0, "c": "181e"}]


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
         "e": "Alpha only.", "p": False, "es": [{"o": 0, "c": "2a"}]},
        {"s": None, "d": None, "g": {"c": "2b", "n": 5, "o": 0},
         "e": "Beta only.", "p": False, "es": [{"o": 0, "c": "2b"}]},
    ]
    assert stats == {"rows": 2, "paragraphs": 2, "sections": 2, "snapped": 0}


def test_para_flow_carries_section_starts_across_a_row():
    segs = [_pseg("2a", 1), _pseg("2b", 5), _pseg("2c", 9)]
    chunks = [_pchunk("2a", "Alpha", para_start=True),
              _pchunk("2b", "Beta"),
              _pchunk("2c", "Gamma", para_start=True)]
    flow, _ = turns.build_para_flow(segs, chunks)
    assert flow["turns"][0]["e"] == "Alpha Beta"
    assert flow["turns"][0]["es"] == [
        {"o": 0, "c": "2a"},
        {"o": 6, "c": "2b"},
    ]


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
    assert stats == {"rows": 1, "paragraphs": 3, "sections": 1, "snapped": 0}


# A section whose Greek is four sentences, one per line — enough for a
# proportional cut to have somewhere to land.
def _gseg(column, first_n, texts, book=1):
    return {"id": f"{book}:{column}", "book": book, "column": column,
            "lines": [{"n": first_n + i, "text": t} for i, t in enumerate(texts)],
            "speakers": []}


def test_para_flow_cuts_the_greek_where_the_paragraph_starts():
    # The break sits ~3/4 through 3b's English, so the row's Greek starts ~3/4
    # through 3b's Greek — at the sentence end nearest that point, NOT at the
    # next section. (Anchoring on a section boundary is the Republic 450a
    # defect: the previous row's Greek ran on past its English, leaving the
    # English column blank while the Greek caught up.)
    segs = [_gseg("3a", 1, ["Alpha one."]),
            _gseg("3b", 10, ["Beta one. Beta two.", "Beta three. Beta four."]),
            _gseg("3c", 20, ["Gamma one."])]
    chunks = [_pchunk("3a", "Book opening line.", para_start=True),
              _pchunk("3b", "b1. b2. b3. NEWPARA.", paras=[12]),
              _pchunk("3c", "Gamma open.", para_start=True)]
    flow, _ = turns.build_para_flow(segs, chunks)
    assert [r["g"]["c"] for r in flow["turns"]] == ["3a", "3b", "3c"]
    # 12/20 through 3b's 42 Greek characters targets offset 25, mid "three";
    # the nearest sentence end is 20, which opens 3b's second line.
    assert flow["turns"][1]["g"] == {"c": "3b", "n": 11, "o": 0}


def test_para_flow_cut_snaps_to_a_greek_sentence_end():
    # The proportional target lands mid-sentence; the cut snaps to the sentence
    # boundary rather than slicing a clause in half.
    segs = [_gseg("3a", 1, ["Alpha one."]),
            _gseg("3b", 10, ["Beta one is longer. Beta two."])]
    chunks = [_pchunk("3a", "Opening.", para_start=True),
              _pchunk("3b", "0123456789 NEWPARA.", paras=[11])]
    flow, _ = turns.build_para_flow(segs, chunks)
    # 11/19 of 28 characters targets offset 16, mid "longer"; the nearest
    # sentence end is after "Beta one is longer. " at 20.
    assert flow["turns"][1]["g"] == {"c": "3b", "n": 10, "o": 20}


def test_para_flow_merges_a_paragraph_whose_cut_would_go_backwards():
    # Two paragraphs in the same section resolving to the same cut merge into
    # one row (anchors stay strictly monotone) — the reader would otherwise get
    # a row with no Greek at all.
    segs = [_gseg("3a", 1, ["Alpha one. Alpha two."])]
    chunks = [_pchunk("3a", "a1. a2.", paras=[0, 4], para_start=True)]
    flow, _ = turns.build_para_flow(segs, chunks)
    assert len(flow["turns"]) == 1
    assert flow["turns"][0]["g"] == {"c": "3a", "n": 1, "o": 0}
    assert flow["turns"][0]["ep"] == [4]


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
    assert stats == {"rows": 2, "paragraphs": 3, "sections": 2, "snapped": 0}


def test_para_flow_none_when_under_two_paragraphs():
    # One real paragraph signal (a single interior marker, no para_start) is
    # below threshold BEFORE the book-start seed, so no flow.
    segs = [_pseg("2a", 1)]
    chunks = [_pchunk("2a", "One break only here.", paras=[4])]
    flow, stats = turns.build_para_flow(segs, chunks)
    assert flow is None
    assert stats == {"rows": 0, "paragraphs": 1, "sections": 1, "snapped": 0}


def test_para_flow_carries_embedded_turns_as_et():
    segs = [_pseg("5a", 1), _pseg("5b", 10)]
    chunks = [_pchunk("5a", "Zero one two three.", para_start=True,
                      turns_=[{"offset": 5, "speaker": "Socrates",
                               "display": "Soc."}]),
              _pchunk("5b", "Beta.", para_start=True)]
    flow, _ = turns.build_para_flow(segs, chunks)
    assert flow["turns"][0]["et"] == [{"o": 5, "s": "Socrates", "d": "Soc."}]
    assert "et" not in flow["turns"][1]


# --- B3: Burnet's marks as the row spine (Republic) ----------------------------
#
# The English-led path above cuts rows where the TRANSLATION breaks a paragraph.
# Spine mode inverts that: one row per Burnet mark, the English cut at the point
# matching it. The fixtures are 327c's exchange, shortened.

_SPINE_SEGS = [
    _gseg("2a", 1, ["οὐ γὰρ κακῶς δοξάζεις, ἦν δʼ ἐγώ.",
                    "ὁρᾷς οὖν ἡμᾶς, ἔφη, ὅσοι ἐσμέν;",
                    "πῶς γὰρ οὔ;"]),
    _gseg("2b", 4, ["οὐδαμῶς, ἔφη ὁ Γλαύκων.",
                    "ὡς τοίνυν μὴ ἀκουσομένων, οὕτω διανοεῖσθε."]),
]
_SPINE_MARKS = [{"c": "2a", "n": 1, "o": 0}, {"c": "2a", "n": 2, "o": 0},
                {"c": "2a", "n": 3, "o": 0}, {"c": "2b", "n": 4, "o": 0},
                {"c": "2b", "n": 5, "o": 0}]
_E_2A = "Not a bad guess, said I. But you see how many we are? he said. Surely."
_E_2B = "Nohow, said Glaucon. Well, we won’t listen."


def _quoted(text, *fragments):
    """(start, end) speech-run markers for each quoted fragment of `text`."""
    return tuple((text.index(f), text.index(f) + len(f)) for f in fragments)


_Q_2A = _quoted(_E_2A, "Not a bad guess,", "But you see how many we are?",
                "Surely.")
_Q_2B = _quoted(_E_2B, "Nohow,", "Well, we won’t listen.")


def _spine_chunks(**over):
    a = _pchunk("2a", _E_2A, speeches=_Q_2A, **over.pop("a", {}))
    b = _pchunk("2b", _E_2B, speeches=_Q_2B, **over.pop("b", {}))
    return [a, b]


def test_para_flow_spine_cuts_a_row_at_every_burnet_mark():
    # Five Burnet paragraphs, five rows — where the English-led path would give
    # two (one per section, Shorey breaking neither).
    flow, stats = turns.build_para_flow(
        _SPINE_SEGS, _spine_chunks(), greek_paras=_SPINE_MARKS, spine=True)
    assert flow["kind"] == "para"
    assert flow["leadE"] is None
    assert [(r["g"]["c"], r["g"]["n"]) for r in flow["turns"]] == [
        ("2a", 1), ("2a", 2), ("2a", 3), ("2b", 4), ("2b", 5)]
    assert [r["e"] for r in flow["turns"]] == [
        "Not a bad guess, said I.",
        "But you see how many we are? he said.",
        "Surely.",
        "Nohow, said Glaucon.",
        "Well, we won’t listen.",
    ]
    assert stats["spine_marks"] == 5
    assert stats["spine_matched"] == 5
    assert stats["spine_unmatched"] == 0


def test_para_flow_spine_is_off_by_default():
    # Same data, no spine flag: the old English-led cutting, two rows.
    flow, stats = turns.build_para_flow(
        _SPINE_SEGS, _spine_chunks(a={"para_start": True},
                                   b={"para_start": True}),
        greek_paras=_SPINE_MARKS)
    assert [r["e"] for r in flow["turns"]] == [_E_2A, _E_2B]
    assert "spine_marks" not in stats


def test_para_flow_spine_merges_a_mark_with_no_english_counterpart():
    # 2b's English is one unbroken run, so its second mark has nowhere to cut:
    # it merges into the previous row rather than opening a Greek-only one.
    chunks = [_pchunk("2a", _E_2A, speeches=_Q_2A),
              _pchunk("2b", "Nohow said Glaucon and we would not listen")]
    flow, stats = turns.build_para_flow(
        _SPINE_SEGS, chunks, greek_paras=_SPINE_MARKS, spine=True)
    assert [(r["g"]["c"], r["g"]["n"]) for r in flow["turns"]] == [
        ("2a", 1), ("2a", 2), ("2a", 3), ("2b", 4)]
    assert flow["turns"][-1]["e"] == "Nohow said Glaucon and we would not listen"
    assert stats["spine_marks"] == 5
    assert stats["spine_matched"] == 4
    assert stats["spine_unmatched"] == 1
    _assert_flow_invariants(flow, _SPINE_SEGS)


def test_para_flow_spine_carries_an_interior_english_paragraph_as_ep():
    # A translation paragraph break that is not a row start still prints: it
    # rides `ep` on the row it falls in.
    chunks = _spine_chunks(b={"paras": [_E_2B.index("Well,")]})
    flow, _ = turns.build_para_flow(
        _SPINE_SEGS, chunks, greek_paras=_SPINE_MARKS[:4], spine=True)
    row = flow["turns"][-1]
    assert row["e"] == "Nohow, said Glaucon. Well, we won’t listen."
    assert row["ep"] == [_E_2B.index("Well,")]


def test_para_flow_spine_seeds_the_book_start_as_a_row():
    # The book's first mark is a section into the text: everything before it
    # still has to be a row, not a lead-in blob.
    marks = _SPINE_MARKS[1:]
    flow, _ = turns.build_para_flow(
        _SPINE_SEGS, _spine_chunks(), greek_paras=marks, spine=True)
    assert flow["leadE"] is None
    assert flow["turns"][0]["g"] == {"c": "2a", "n": 1, "o": 0}
    assert flow["turns"][0]["e"] == "Not a bad guess, said I."


def test_para_flow_spine_reports_every_mark_it_saw():
    _, stats = turns.build_para_flow(
        _SPINE_SEGS, _spine_chunks(), greek_paras=_SPINE_MARKS, spine=True)
    report = stats["spine_report"]
    assert len(report) == 5
    assert report[0]["c"] == "2a"
    assert report[0]["greek"].startswith("οὐ γὰρ κακῶς")
    assert report[0]["english"].startswith("Not a bad guess")


def test_para_flow_spine_none_when_the_donor_has_under_two_marks():
    flow, stats = turns.build_para_flow(
        _SPINE_SEGS, _spine_chunks(), greek_paras=_SPINE_MARKS[:1], spine=True)
    assert flow is None
    assert stats["rows"] == 0


def test_invariants_hold_for_a_spine_para_flow():
    flow, _ = turns.build_para_flow(
        _SPINE_SEGS, _spine_chunks(), greek_paras=_SPINE_MARKS, spine=True)
    _assert_flow_invariants(flow, _SPINE_SEGS)


# Perseus' English section milestone is Shorey's page break, and it lands LATER
# than Burnet's Greek one at many boundaries: here "Nohow," opens 2b's first
# Greek paragraph but sits at the end of the 2a chunk. Cutting inside 2b only
# would open that row on "said Glaucon."
_LAG_2A = _E_2A + " Nohow,"
_LAG_2B = "said Glaucon. Well, we won’t listen."


def _lagged_chunks():
    return [_pchunk("2a", _LAG_2A,
                    speeches=_quoted(_LAG_2A, "Not a bad guess,",
                                     "But you see how many we are?", "Surely.",
                                     "Nohow,")),
            _pchunk("2b", _LAG_2B,
                    speeches=_quoted(_LAG_2B, "Well, we won’t listen."))]


def test_para_flow_spine_cuts_in_the_previous_chunk_when_the_milestone_lags():
    flow, stats = turns.build_para_flow(
        _SPINE_SEGS, _lagged_chunks(), greek_paras=_SPINE_MARKS, spine=True)
    assert [r["e"] for r in flow["turns"]] == [
        "Not a bad guess, said I.",
        "But you see how many we are? he said.",
        "Surely.",
        "Nohow, said Glaucon.",
        "Well, we won’t listen.",
    ]
    assert stats["spine_matched"] == 5
    _assert_flow_invariants(flow, _SPINE_SEGS)


def test_a_carried_row_marks_the_section_boundary_inside_itself():
    # The row's Greek still anchors at 2b's mark; its English starts a chunk
    # early, so 2b's own section tick moves inside the row — once, at the
    # boundary, which is what the reader's one-tick-per-section rule needs.
    flow, _ = turns.build_para_flow(
        _SPINE_SEGS, _lagged_chunks(), greek_paras=_SPINE_MARKS, spine=True)
    row = flow["turns"][3]
    assert row["g"] == {"c": "2b", "n": 4, "o": 0}
    assert row["es"] == [{"o": len("Nohow, "), "c": "2b"}]
    assert row["e"][row["es"][0]["o"]:].startswith("said Glaucon")
    ticks = [e["c"] for t in flow["turns"] for e in t.get("es", [])]
    assert sorted(ticks) == ["2a", "2b"]        # one per section, no repeats


def test_a_carried_cut_leaves_one_row_per_matched_mark():
    # Rows = matched marks + the seeded book start, exactly: a carried cut that
    # stepped on the row before it would show up here as a merge.
    flow, stats = turns.build_para_flow(
        _SPINE_SEGS, _lagged_chunks(), greek_paras=_SPINE_MARKS[1:], spine=True)
    assert len(flow["turns"]) == stats["spine_matched"] + 1
    _assert_flow_invariants(flow, _SPINE_SEGS)


# --- coverage + non-empty invariants (integration) -----------------------------

def _assert_flow_invariants(flow, segs):
    """Every emitted English slice (e and sub[].e) is non-empty; the g-ref chain
    covers the Greek spine: the first g ref sits at the first column carrying a
    Greek turn event (the reader's lead row renders any earlier, event-less
    Greek) and refs are monotone in spine order (slice-to-next-g then covers
    every later column)."""
    spine: list[str] = []
    for s in segs:
        if s["column"] not in spine:
            spine.append(s["column"])
    rank = {c: i for i, c in enumerate(spine)}
    first_event_col = next(
        (s["column"] for s in segs if s.get("speakers")), spine[0])
    g_cols = [t["g"]["c"] for t in flow["turns"] if t.get("g")]
    assert g_cols, "flow carries no Greek refs"
    # Head section-anchored rows may start the chain BEFORE the first
    # event-bearing column (narrated openings); never after it.
    assert rank[g_cols[0]] <= rank[first_event_col], \
        f"first g ref {g_cols[0]} after first event col {first_event_col}"
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
