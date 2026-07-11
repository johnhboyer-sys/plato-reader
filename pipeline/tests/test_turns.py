import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "pipeline"))

from plato_pipeline import turns


SIGLA = {"ΣΩ.": "Socrates", "ΕΥΘ.": "Euthyphro", "ΙΠ.": "Hippias"}


def _g(line, offset, label):
    return {"line": line, "offset": offset, "label": label}


def _e(offset, speaker, display=None):
    return {"offset": offset, "speaker": speaker, "display": display}


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


# --- pairing -----------------------------------------------------------------

def test_matching_sequences_pair_in_order():
    g = [_g(1, 0, "ΕΥΘ."), _g(5, 0, "ΣΩ.")]
    e = [_e(0, "Euthyphro", "Euth."), _e(40, "Socrates", "Soc.")]
    pairs, unmapped = turns.pair_segment(g, e, SIGLA)
    assert unmapped == []
    assert pairs == [
        {"g": {"line": 1, "offset": 0}, "e": {"offset": 0},
         "speaker": "Euthyphro", "display": "Euth."},
        {"g": {"line": 5, "offset": 0}, "e": {"offset": 40},
         "speaker": "Socrates", "display": "Soc."},
    ]


def test_null_greek_dash_is_a_wildcard():
    # A bare "—" pairs against any named English turn and takes the named side.
    g = [_g(1, 0, "—"), _g(2, 0, "—")]
    e = [_e(0, "Hippias", "Hipp."), _e(10, None, None)]
    pairs, _ = turns.pair_segment(g, e, SIGLA)
    assert [p["speaker"] for p in pairs] == ["Hippias", None]


def test_length_mismatch_yields_no_pairs():
    g = [_g(1, 0, "ΕΥΘ."), _g(5, 0, "ΣΩ.")]
    e = [_e(0, "Euthyphro", "Euth.")]
    pairs, _ = turns.pair_segment(g, e, SIGLA)
    assert pairs is None


def test_name_disagreement_yields_no_pairs():
    g = [_g(1, 0, "ΕΥΘ.")]
    e = [_e(0, "Socrates", "Soc.")]
    pairs, _ = turns.pair_segment(g, e, SIGLA)
    assert pairs is None


def test_empty_both_sides_pairs_as_continuation():
    pairs, _ = turns.pair_segment([], [], SIGLA)
    assert pairs == []


# --- reconciliation over a work ----------------------------------------------

def test_reconcile_counts_and_attaches_pairs():
    segments = [
        {"id": "1:2a", "speakers": [_g(1, 0, "ΕΥΘ."), _g(5, 0, "ΣΩ.")]},
        {"id": "1:2b", "speakers": [_g(1, 0, "ΕΥΘ.")]},          # mismatch (extra)
        {"id": "1:2c", "speakers": []},                          # continuation
    ]
    english = {
        "1:2a": {"turns": [_e(0, "Euthyphro", "Euth."), _e(9, "Socrates", "Soc.")]},
        "1:2b": {"turns": [_e(0, "Euthyphro"), _e(4, "Socrates")]},  # 2 vs 1
        "1:2c": {"turns": []},
    }
    report = turns.reconcile_work(segments, english, SIGLA)
    assert report["dialogue_segments"] == 2   # 2c excluded (0/0)
    assert report["paired"] == 1
    assert report["mismatched"] == ["1:2b"]
    assert "turnPairs" in segments[0]
    assert "turnPairs" not in segments[1]
    assert "turnPairs" not in segments[2]


def test_reconcile_reports_unmapped_siglum():
    segments = [{"id": "1:2a", "speakers": [_g(1, 0, "ΧΧ.")]}]
    english = {"1:2a": {"turns": [_e(0, "Whoever")]}}
    report = turns.reconcile_work(segments, english, SIGLA)
    assert report["unmapped"] == {"ΧΧ.": 1}
