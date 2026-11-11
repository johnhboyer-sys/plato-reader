"""The popup's readings carry their part of speech, from the table search
uses (pos_table.json: LSJ, else the Cambridge lexicon, else Morpheus)
(John, 2026-11-10, P2)."""

from plato_pipeline.stage7_emit import apply_pos


def reading(lemma, parse, lsj, gloss=""):
    return {"lemma": lemma, "parse": parse, "lsj": list(lsj), "gloss": gloss}


def test_each_reading_gains_its_part_of_speech():
    rs = [
        reading("a)lla/", "indeclform (adverb)", ["a)lla/"]),
        reading("le/gw3", "pres ind act 1st sg", ["le/gw"]),
        reading("le/gos", "masc/neut gen sg (doric aeolic)", ["le/gos"]),
    ]
    apply_pos(rs)
    # ἀλλά is adverb and conjunction: Smyth decides the particles (John 2026-11-11).
    assert [r["pos"] for r in rs] == [["adverb", "conj"], ["verb"], ["adj"]]


def test_a_word_of_two_classes_carries_both():
    rs = [reading("a)/llos", "masc nom sg", ["a)/llos"])]
    apply_pos(rs)
    assert rs[0]["pos"] == ["adj", "pronoun"]


def test_a_lemma_the_table_lacks_gets_no_pos_field():
    rs = [reading("zzzz", "indeclform (particle)", [])]
    apply_pos(rs)
    assert "pos" not in rs[0]


def test_readings_keep_the_lsj_entry_they_link():
    # LSJ prints ἄν (B) "if" in full inside its ἄν entry (key a)/n), with
    # Plato's uses; ἐάν only points back to it. So no reading is relinked.
    rs = [reading("a)/n2", "attic (indeclform conj)", ["a)/n"], "if (= ἐάν)")]
    apply_pos(rs)
    assert rs[0]["lsj"] == ["a)/n"]


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
    mark_unlikely(rs, listed={})
    assert [r.get("unlikely", False) for r in rs] == [True, True, True, False, False]


def test_a_listed_reading_is_unlikely_only_under_its_host():
    # λέγος is dimmed where λέγω is also a reading; μάλη "arm-pit" under
    # μάλα, but not at Gorgias 469d (ὑπὸ μάλης), where it is the only sense.
    listed = {"le/gos": ["le/gw"], "ma/lh": ["ma/la"]}
    rs = [reading("le/gos", "masc/neut nom/voc/acc dual", ["le/gos"]), reading("le/gw3", "pres ind act 1st sg", ["le/gw"])]
    mark_unlikely(rs, listed=listed)
    assert [r.get("unlikely", False) for r in rs] == [True, False]
    rs = [reading("ma/lh", "fem gen sg (attic epic ionic)", ["ma/lh"])]
    mark_unlikely(rs, listed=listed)
    assert rs[0].get("unlikely", False) is False


def test_a_numbered_host_matches_only_itself():
    listed = {"e)ra/w2": ["e)ra/w1"]}
    rs = [reading("e)ra/w2", "pres ind act 3rd sg", ["e)ra/w2"]), reading("e)ra/w1", "pres ind act 3rd sg", ["e)ra/w1"])]
    mark_unlikely(rs, listed=listed)
    assert [r.get("unlikely", False) for r in rs] == [True, False]


def test_the_committed_list_loads_as_lemmas():
    from plato_pipeline.stage7_emit import load_unlikely_lemmas
    listed = load_unlikely_lemmas()
    assert listed and all(isinstance(k, str) and k and v and all(isinstance(h, str) and h for h in v) for k, v in listed.items())


def test_a_dialect_named_before_the_parenthesis_counts_too():
    # Morpheus writes some uninflected readings "doric aeolic (proclitic
    # indeclform prep)": the dialects lead, the parenthesis holds the class.
    rs = [
        reading("ei)s", "doric aeolic (proclitic indeclform prep)", ["ei)s"]),
        reading("pote/", "aeolic (enclitic indeclform particle)", ["pote/"]),
        reading("a)lla/", "attic (indeclform adverb)", ["a)lla/"]),
    ]
    mark_unlikely(rs, listed={})
    assert [r.get("unlikely", False) for r in rs] == [True, True, False]
