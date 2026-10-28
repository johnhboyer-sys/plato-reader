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

import copy
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
    [{"surface": "x", "justification": "j"}],                  # no lemma, gloss or other_glosses
    [{"surface": "x", "parse": "p", "gloss": "g", "justification": "j"}],  # parse without lemma
    [{"surface": "x", "lemma": "", "justification": "j"}],
    [{"surface": "x", "lemma": "l", "parse": 1, "justification": "j"}],
    [{"surface": "x", "gloss": "", "justification": "j"}],
    [{"surface": "x", "other_glosses": {}, "justification": "j"}],
    [{"surface": "x", "other_glosses": ["l", "g"], "justification": "j"}],
    [{"surface": "x", "other_glosses": {"l": ""}, "justification": "j"}],
    [{"surface": "x", "other_glosses": {"l": 1}, "justification": "j"}],
    [{"surface": "x", "gloss": "g", "scope": "aristotle", "justification": "j"}],
    [{"surface": "x", "lemma": "l", "justification": "j"},
     {"surface": "x", "lemma": "m", "justification": "j"}],    # duplicate
    {"x": {"lemma": "l"}},                                     # not a list
])
def test_loader_rejects_a_malformed_table(tmp_path, entries):
    path = tmp_path / "overrides.json"
    path.write_text(json.dumps(entries), encoding="utf-8")

    with pytest.raises(ValueError):
        load_morphology_overrides(path)


def test_an_override_gloss_applies_to_the_promoted_reading():
    parses = [_reading("mei/s", "masc nom/voc sg", "month"),
              _reading("mh/n", "indeclform (particle)", "month")]
    table = _table(**{"mh/n": {"lemma": "mh/n", "gloss": "truly"}})

    out = apply_morphology_override([dict(p) for p in parses], "mh/n", table)

    assert out == [{**parses[1], "gloss": "truly"}, parses[0]]


def test_an_override_gloss_replaces_a_junk_gloss_in_place():
    parses = [_reading("ou)", "proclitic indeclform (adverb)", "u")]

    [top] = apply_morphology_override(parses, "ou)", _table(**{"ou)": {"gloss": "not"}}))

    assert top == {**parses[0], "gloss": "not"}


def test_an_entry_whose_lemma_matches_nothing_glosses_nothing():
    parses = [_reading("ou)", "proclitic indeclform (adverb)", "u")]
    table = _table(**{"ou)": {"lemma": "not-offered", "gloss": "not"}})

    assert apply_morphology_override(parses, "ou)", table) == parses


def test_other_glosses_reglosses_readings_behind_the_front_one():
    parses = [_reading("a)/n1", "indeclform (particle)", "he came"),
              _reading("a)/n2", "attic (indeclform conj)", "he came"),
              _reading("a)na/", "poetic indeclform (prep)", "on board")]
    table = _table(**{"a)/n": {"lemma": "a)/n1", "gloss": "modal particle",
                               "other_glosses": {"a)/n2": "if", "a)/n1": "never"}}})

    out = apply_morphology_override([dict(p) for p in parses], "a)/n", table)

    assert [p["gloss"] for p in out] == ["modal particle", "if", "on board"]
    assert [(p["lemma"], p["parse"], p["lsj"]) for p in out] == [
        (p["lemma"], p["parse"], p["lsj"]) for p in parses]


def test_other_glosses_alone_leaves_the_front_reading_and_order_alone():
    parses = [_reading("i)/sos", "fem acc pl", "equal"),
              _reading("oi)=da", "pres ind act 2nd sg", "behold!")]
    table = _table(**{"i)/sas": {"other_glosses": {"oi)=da": "know"}}})

    out = apply_morphology_override([dict(p) for p in parses], "i)/sas", table)

    assert out == [parses[0], {**parses[1], "gloss": "know"}]


def test_gloss_and_other_glosses_do_not_mutate_their_input():
    parses = [_reading("a)/n1", "indeclform (particle)", "he came"),
              _reading("a)/n2", "attic (indeclform conj)", "he came")]
    before = copy.deepcopy(parses)
    table = _table(**{"a)/n": {"gloss": "modal particle",
                               "other_glosses": {"a)/n2": "if"}}})

    out = apply_morphology_override(parses, "a)/n", table)

    assert parses == before
    assert [p["gloss"] for p in out] == ["modal particle", "if"]


def test_the_override_gloss_wins_over_the_short_def_repair(monkeypatch):
    """resolve_parses extends Morpheus's glosses first, then applies the table."""
    parses = [_reading("ou)", "proclitic indeclform (adverb)", "u")]
    assert resolve_parses([dict(p) for p in parses], {"ou)": "u, not"})[0]["gloss"] == "u, not"

    monkeypatch.setitem(MORPHOLOGY_OVERRIDES, "test-ou",
                        {"surface": "test-ou", "gloss": "not", "justification": "test"})
    out = resolve_parses([dict(p) for p in parses], {"ou)": "u, not"}, "test-ou")

    assert out[0]["gloss"] == "not"


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


def test_dei_opens_on_impersonal_dei_must():
    """δεῖ 'one must': δέω (B), third singular, not δέω 'bind' or a middle."""
    parses = [
        _reading(lemma, parse)
        for lemma in ("de/w1", "de/w2")
        for parse in (
            "pres ind mp 2nd sg (attic epic doric ionic)",
            "pres imperat act 2nd sg (attic epic)",
            "pres ind act 3rd sg (attic epic doric ionic)",
            "imperf ind act 3rd sg (attic epic)",
        )
    ]

    out = resolve_parses([dict(p) for p in parses], {}, "dei=")

    assert (out[0]["lemma"], out[0]["parse"]) == (
        "de/w2", "pres ind act 3rd sg (attic epic doric ionic)")


def test_lego_opens_on_lego_say_not_legos_lewd():
    parses = [
        _reading("le/gos", "masc/neut nom/voc/acc dual"),
        _reading("le/gos", "masc/neut gen sg (doric aeolic)"),
    ] + [
        _reading(lemma, parse)
        for lemma in ("le/gw1", "le/gw2", "le/gw3")
        for parse in ("pres subj act 1st sg", "pres ind act 1st sg")
    ]

    out = resolve_parses([dict(p) for p in parses], {}, "le/gw")

    assert (out[0]["lemma"], out[0]["parse"]) == ("le/gw3", "pres ind act 1st sg")


def test_o_before_a_vocative_is_the_interjection():
    parses = [
        _reading("ei)mi/", "pres subj act 1st sg (attic epic doric)"),
        _reading("w)=", "indeclform (exclam)"),
    ]

    assert resolve_parses([dict(p) for p in parses], {}, "w)=")[0] == parses[1]


def _raw_morpheus_readings(surfaces):
    """Each surface's readings as greek-analyses.txt holds them (stage 4's own
    parser), in rank_parses order: what the table is applied to, less the
    filter and the short-def extension, which never reorder readings."""
    from plato_pipeline.config import Manifest
    from plato_pipeline.stage4_morphology import parse_analysis_line

    path = Manifest.for_work("Republic").diogenes_data() / "greek-analyses.txt"
    if not path.exists():
        pytest.skip("requires Diogenes' greek-analyses.txt")
    found = {}
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            key, _, value = line.partition("\t")
            if key in surfaces:
                found[key] = rank_parses([
                    {"lemma": a["lemma"], "gloss": a["gloss"].strip(), "parse": a["parse"]}
                    for a in parse_analysis_line(value)
                ])
    return found


def test_every_override_does_what_it_promises_on_the_raw_morpheus_readings():
    """Apply each entry to its surface's ranked Morpheus readings and check the
    promise: the front reading has the entry's lemma, parse and gloss; every
    other_glosses lemma names a reading behind the front one, and those carry
    the gloss; nothing is invented; and the entry changes something, so an
    apply that returned its input would fail here. The raw readings carry no
    LSJ keys, so filter_parses cannot run here: an entry whose target the
    filter drops passes this check, and only a rebuild shows it."""
    raw = _raw_morpheus_readings(set(MORPHOLOGY_OVERRIDES))
    assert raw, "examined no override surface at all"

    problems = []
    for surface, entry in MORPHOLOGY_OVERRIDES.items():
        readings = raw.get(surface)
        if not readings:
            problems.append((surface, "not a key of greek-analyses.txt"))
            continue
        out = apply_morphology_override([dict(p) for p in readings], surface)
        top = out[0]
        if out == readings:
            problems.append((surface, "changes nothing"))
        if (top["lemma"], top["parse"]) not in {(p["lemma"], p["parse"]) for p in readings}:
            problems.append((surface, "invented a reading"))
        if top["lemma"] != entry.get("lemma", top["lemma"]):
            problems.append((surface, "lemma not first"))
        if top["parse"] != entry.get("parse", top["parse"]):
            problems.append((surface, "parse not first"))
        if top["gloss"] != entry.get("gloss", top["gloss"]):
            problems.append((surface, "gloss not applied"))
        for lemma, gloss in entry.get("other_glosses", {}).items():
            behind = [p for p in out[1:] if p["lemma"] == lemma]
            if not behind:
                problems.append((surface, f"other_glosses {lemma} matches no reading"))
            elif any(p["gloss"] != gloss for p in behind):
                problems.append((surface, f"other_glosses {lemma} not applied"))

    assert problems == [], f"{len(problems)} problems: {problems[:8]}"


def test_the_raw_check_fails_when_apply_does_nothing(monkeypatch):
    """The check above must not pass on an identity apply."""
    monkeypatch.setattr(
        sys.modules[__name__], "apply_morphology_override",
        lambda parses, surface, overrides=None: parses)
    with pytest.raises(AssertionError):
        test_every_override_does_what_it_promises_on_the_raw_morpheus_readings()
