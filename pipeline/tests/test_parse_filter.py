import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "pipeline"))

from plato_pipeline.parse_filter import filter_parses


def test_filter_parses_drops_redundant_unresolved_readings_only():
    resolved = {"lemma": "ἡδονή", "gloss": "pleasure", "lsj": [{"id": "h(donh/"}]}
    duplicate_unresolved = {"lemma": "ἡδονά", "gloss": "pleasure", "lsj": []}
    blank_unresolved = {"lemma": "noise", "gloss": "  ", "lsj": []}
    distinct_unresolved = {"lemma": "πέλω", "gloss": "to be", "lsj": []}

    assert filter_parses(
        [resolved, duplicate_unresolved, blank_unresolved, distinct_unresolved]
    ) == [resolved, distinct_unresolved]


def test_filter_parses_keeps_all_unresolved_tokens_so_it_never_empties():
    parses = [
        {"lemma": "rare", "gloss": "", "lsj": []},
        {"lemma": "name", "gloss": "proper name", "lsj": []},
    ]

    assert filter_parses(parses) == parses


def test_filter_parses_keeps_unresolved_distinct_gloss_with_resolved_sibling():
    resolved = {"lemma": "resolved", "gloss": "carrying", "lsj": [{"id": "ferw"}]}
    distinct = {"lemma": "unresolved", "gloss": "bearing away", "lsj": []}

    assert filter_parses([resolved, distinct]) == [resolved, distinct]


# ── which reading comes first: the one a token is filed under ───────────────

from plato_pipeline.stage7_emit import resolve_parses

# Diogenes' readings for ἀρετῆς and ἀρετῇ, in its order: alphabetical by lemma,
# so the Doric contracted forms of ἀρετάω 'thrive' come before ἀρετή.
ARETAO = {"lemma": "a)reta/w", "gloss": "thrive, prosper", "lsj": ["a)reta/w"]}
ARETE = {"lemma": "a)reth/", "gloss": "goodness, excellence", "lsj": ["a)reth/"]}
ARETES = [
    {**ARETAO, "parse": "pres ind act 2nd sg (doric aeolic)"},
    {**ARETAO, "parse": "pres ind act 2nd sg (epic doric ionic aeolic)"},
    {**ARETE, "parse": "fem gen sg (attic epic ionic)"},
]
ARETEI = [
    {**ARETAO, "parse": parse}
    for parse in (
        "pres subj mp 2nd sg (doric)",
        "pres ind mp 2nd sg (doric aeolic)",
        "pres subj act 3rd sg (doric)",
        "pres ind act 3rd sg (doric aeolic)",
        "pres subj mp 2nd sg (epic ionic)",
        "pres ind mp 2nd sg (epic doric ionic aeolic)",
        "pres subj act 3rd sg (epic ionic)",
    )
] + [{**ARETE, "parse": "fem dat sg (attic epic ionic)"}]


def test_aretes_and_aretei_are_filed_under_arete_not_aretao():
    for readings in (ARETES, ARETEI):
        out = resolve_parses([dict(p) for p in readings], {})

        assert out[0] == readings[-1], "ἀρετή, with its own parse and LSJ key"
        assert out[1:] == readings[:-1], "the verb's readings stay, behind it"


# ── rank_parses: Plato writes Attic ─────────────────────────────────────────

import json

import pytest

from plato_pipeline.parse_filter import (
    MORPHOLOGY_OVERRIDES,
    apply_morphology_override,
    load_morphology_overrides,
    rank_parses,
)


def _reading(lemma, parse, gloss="g"):
    return {"lemma": lemma, "gloss": gloss, "parse": parse, "lsj": [lemma]}


def test_rank_keeps_an_unmarked_first_reading_first():
    """ἄν and ἐν open on the particle and the preposition, as Morpheus has them:
    ranking moves only readings marked for other dialects alone."""
    an = [_reading("a)/n1", "indeclform (particle)"),
          _reading("a)/n2", "attic (indeclform conj)"),
          _reading("a)na/", "poetic indeclform (prep)"),
          _reading("e)a/n", "contr indeclform (conj)")]
    en = [_reading("e)n", "proclitic indeclform (prep)"),
          _reading("ei)s", "doric aeolic (proclitic indeclform prep)")]

    assert rank_parses(an) == [an[0], an[1], an[3], an[2]], "poetic ἀνά goes last"
    assert rank_parses(en) == en


def test_rank_is_stable_and_keeps_all_non_attic_readings_in_order():
    oi = [_reading("e(/", "masc/fem dat sg (epic ionic)"),
          _reading("o(", "masc nom/voc pl")]
    nai = [_reading("a", "pres ind act 2nd sg (doric)"),
           _reading("b", "masc nom sg (epic ionic)")]

    assert rank_parses(oi) == [oi[1], oi[0]], "οἱ, the article"
    assert rank_parses(nai) == nai, "nothing Attic to put first"


def test_a_reading_naming_attic_among_its_dialects_is_attic():
    parses = [_reading("x", "pres inf act (doric ionic)"),
              _reading("y", "pres inf act (attic epic doric)")]

    assert rank_parses(parses) == [parses[1], parses[0]]


# ── curated overrides: Morpheus marks some Attic forms non-Attic ────────────


def _table(**entries):
    return {surface: {"surface": surface, "justification": "test", **fields}
            for surface, fields in entries.items()}


DOXAN = [  # Morpheus's readings for δόξαν, in its order
    {"lemma": "do/ca", "gloss": "expectation", "parse": "fem acc sg (doric aeolic)",
     "lsj": ["do/ca^"]},
    {"lemma": "doke/w", "gloss": "expect", "parse": "aor part act neut nom/voc/acc sg",
     "lsj": ["doke/w"]},
    {"lemma": "doke/w", "gloss": "expect", "parse": "aor ind act 3rd pl (homeric ionic)",
     "lsj": ["doke/w"]},
]


def test_a_promoted_reading_moves_whole_and_the_rest_keep_their_order():
    ranked = rank_parses([dict(p) for p in DOXAN])
    out = apply_morphology_override(ranked, "do/can", _table(**{"do/can": {"lemma": "do/ca"}}))

    assert ranked[0]["lemma"] == "doke/w", "what ranking alone would do"
    assert out == [DOXAN[0], DOXAN[1], DOXAN[2]]


def test_a_parse_picks_which_reading_of_the_lemma_is_promoted():
    parses = [_reading("tre/fw", "pres subj act 3rd sg (epic)"),
              _reading("ti/qhmi", "aor subj mp 2nd sg"),
              _reading("ti/qhmi", "aor subj act 3rd sg")]
    table = _table(**{"qh=|": {"lemma": "ti/qhmi", "parse": "aor subj act 3rd sg"}})

    assert apply_morphology_override(parses, "qh=|", table) == [
        parses[2], parses[0], parses[1]]


@pytest.mark.parametrize("entry", [
    {"lemma": "not-offered"},
    {"lemma": "ti/qhmi", "parse": "aor subj act 3rd sg (attic)"},
])
def test_an_entry_no_reading_matches_changes_nothing(entry):
    parses = [_reading("tre/fw", "pres subj act 3rd sg (epic)"),
              _reading("ti/qhmi", "aor subj act 3rd sg")]

    assert apply_morphology_override(parses, "qh=|", _table(**{"qh=|": entry})) == parses


def test_override_does_not_mutate_its_input():
    parses = [dict(p) for p in DOXAN[1:]] + [dict(DOXAN[0])]
    before = [dict(p) for p in parses]

    apply_morphology_override(parses, "do/can", _table(**{"do/can": {"lemma": "do/ca"}}))

    assert parses == before


def test_resolve_parses_applies_the_override_for_its_table_key(monkeypatch):
    monkeypatch.setitem(MORPHOLOGY_OVERRIDES, "test-surface",
                        {"surface": "test-surface", "lemma": "doke/w",
                         "parse": "aor ind act 3rd pl (homeric ionic)",
                         "justification": "test"})

    promoted = resolve_parses([dict(p) for p in DOXAN], {}, "test-surface")
    ranked = resolve_parses([dict(p) for p in DOXAN], {}, "other-surface")

    assert promoted[0] == DOXAN[2]
    assert ranked[0] == DOXAN[1]


@pytest.mark.parametrize("entries", [
    [{"surface": "x", "lemma": "l"}],                          # no justification
    [{"surface": "x", "justification": "j"}],                  # no lemma
    [{"surface": "x", "lemma": "l", "gloss": "g", "justification": "j"}],
    [{"surface": "x", "lemma": "", "justification": "j"}],
    [{"surface": "x", "lemma": "l", "parse": 1, "justification": "j"}],
    [{"surface": "x", "lemma": "l", "justification": "j"},
     {"surface": "x", "lemma": "m", "justification": "j"}],    # duplicate
    {"x": {"lemma": "l"}},                                     # not a list
])
def test_loader_rejects_a_malformed_table(tmp_path, entries):
    path = tmp_path / "overrides.json"
    path.write_text(json.dumps(entries), encoding="utf-8")

    with pytest.raises(ValueError):
        load_morphology_overrides(path)


# ── the shipped table ────────────────────────────────────────────────────────


def test_doxan_stays_doxa():
    out = resolve_parses([dict(p) for p in DOXAN], {}, "do/can")

    assert out[0] == DOXAN[0]


def test_the_caves_shadows_stay_skia():
    """τὰς σκιάς (Rep. 515a): Morpheus marks σκιά's plural Ionic only."""
    parses = [
        {"lemma": "skia/", "gloss": "shadow", "parse": "fem acc pl (ionic)",
         "lsj": ["ski^a/"]},
        {"lemma": "skia/s", "gloss": "canopy or arbour", "parse": "fem nom sg",
         "lsj": ["ski^a/s"]},
    ]

    assert resolve_parses([dict(p) for p in parses], {}, "skia/s")[0] == parses[0]


def test_eiretai_opens_on_ero_say():
    parses = [
        {"lemma": "e)/romai", "gloss": "ask, inquire",
         "parse": "pres subj mp 3rd sg (epic ionic)", "lsj": ["e)/romai"]},
        {"lemma": "e)rw=", "gloss": "will say or speak",
         "parse": "perf ind mp 3rd sg (epic ionic)", "lsj": ["e)rw="]},
        {"lemma": "ei)/rw", "gloss": "fasten together in rows",
         "parse": "aor subj mid 3rd sg", "lsj": ["ei)/rw1"]},
    ]

    out = resolve_parses([dict(p) for p in parses], {}, "ei)/rhtai")

    assert (out[0]["lemma"], out[0]["parse"]) == ("e)rw=", "perf ind mp 3rd sg (epic ionic)")


def test_every_shipped_entry_says_why():
    assert MORPHOLOGY_OVERRIDES
    for surface, entry in MORPHOLOGY_OVERRIDES.items():
        assert entry["surface"] == surface
        assert len(entry["justification"]) > 20, surface
