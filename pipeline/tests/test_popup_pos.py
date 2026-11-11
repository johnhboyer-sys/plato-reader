"""The popup's readings carry their part of speech, from the table search
uses (pos_table.json: LSJ, else the Cambridge lexicon, else Morpheus), and
ἄν "if" links to ἐάν, the LSJ entry that treats it (John, 2026-11-10, P2)."""

from plato_pipeline.stage7_emit import apply_pos_and_links


def reading(lemma, parse, lsj, gloss=""):
    return {"lemma": lemma, "parse": parse, "lsj": list(lsj), "gloss": gloss}


def test_each_reading_gains_its_part_of_speech():
    rs = [
        reading("a)lla/", "indeclform (adverb)", ["a)lla/"]),
        reading("le/gw3", "pres ind act 1st sg", ["le/gw"]),
        reading("le/gos", "masc/neut gen sg (doric aeolic)", ["le/gos"]),
    ]
    apply_pos_and_links(rs)
    assert [r["pos"] for r in rs] == [["conj"], ["verb"], ["adj"]]


def test_a_word_of_two_classes_carries_both():
    rs = [reading("a)/llos", "masc nom sg", ["a)/llos"])]
    apply_pos_and_links(rs)
    assert rs[0]["pos"] == ["adj", "pronoun"]


def test_a_lemma_the_table_lacks_gets_no_pos_field():
    rs = [reading("zzzz", "indeclform (particle)", [])]
    apply_pos_and_links(rs)
    assert "pos" not in rs[0]


def test_an_if_links_to_ean_and_other_readings_keep_their_entry():
    rs = [
        reading("a)/n2", "attic (indeclform conj)", ["a)/n"], "if (= ἐάν)"),
        reading("a)/n1", "indeclform (particle)", ["a)/n"]),
    ]
    apply_pos_and_links(rs)
    assert rs[0]["lsj"] == ["e)a/n"]
    assert rs[1]["lsj"] == ["a)/n"]


# "Less likely" (John, 2026-11-10, U2 + "dialect rule + short list"): a reading
# Morpheus tags with dialects that leave out Attic, or calls poetic, or whose
# lemma is on the approved list, is marked `unlikely`.
from plato_pipeline.stage7_emit import mark_unlikely


def test_non_attic_and_poetic_readings_are_unlikely_attic_ones_are_not():
    rs = [
        reading("le/gos", "masc/neut gen sg (doric aeolic)", ["le/gos"]),
        reading("a)na/", "poetic indeclform (prep)", ["a)na/"]),
        reading("o(do/s", "fem nom sg (epic)", ["o(do/s"]),
        reading("le/gw3", "pres ind act 1st sg", ["le/gw"]),
        reading("o(", "masc nom sg (attic epic doric)", ["o("]),
    ]
    mark_unlikely(rs, listed=set())
    assert [r.get("unlikely", False) for r in rs] == [True, True, True, False, False]


def test_a_listed_lemma_is_unlikely_whatever_its_parse():
    rs = [reading("le/gos", "masc/neut nom/voc/acc dual", ["le/gos"]), reading("le/gw3", "pres ind act 1st sg", ["le/gw"])]
    mark_unlikely(rs, listed={"le/gos"})
    assert [r.get("unlikely", False) for r in rs] == [True, False]


def test_the_committed_list_loads_as_lemmas():
    from plato_pipeline.stage7_emit import load_unlikely_lemmas
    listed = load_unlikely_lemmas()
    assert isinstance(listed, set) and all(isinstance(x, str) and x for x in listed)
