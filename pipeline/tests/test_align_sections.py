"""Section starts placed inside an alternate translation's turn."""
from plato_pipeline.align_sections import build_idf, place_sections
from plato_pipeline.align_turns import _row_refs

REF = ("Tell me, Euthyphro, what is piety? Is it not the same in every action? "
       "And impiety is the opposite of piety, always like itself.")
ALT = ("Then tell me, I pray, what you would define piety to be. Is not piety in every "
       "action always the same? And impiety, again, is it not always the opposite of piety?")


def _idf():
    return build_idf([REF, ALT, "the gods quarrel about the just and the unjust"])


def test_identity_is_exact():
    es = [(0, "5c"), (REF.index("Is it not"), "5d"), (REF.index("And impiety"), "5e")]
    got = place_sections(REF, es, REF, _idf())
    assert [(p.o, p.c) for p in got] == es


def test_matches_content_not_position():
    # Jowett-style padding before the matching sentence: proportional
    # placement lands well before it, matching must not.
    # The two texts stay about the same length (as real turns do): the
    # alternate opens with matter the reference puts at its end. (Matter
    # inserted AT the boundary is genuinely ambiguous, so not tested.)
    pad = "So I have often heard it said by the wise men of old, who knew a great deal about such matters. "
    ref = REF + " " + pad.replace("So I have", "Thus we have")
    alt = pad + ALT
    o = ref.index("And impiety")
    proportional = round(o / len(ref) * len(alt))
    assert abs(proportional - alt.index("And impiety")) > 40
    got = {p.c: p.o for p in place_sections(ref, [(0, "5c"), (o, "5d")], alt, _idf())}
    assert got["5c"] == 0
    assert alt[got["5d"]:].startswith("And impiety")
    assert got["5d"] != proportional


def test_more_ticks_than_words_keeps_zero_pin():
    got = place_sections("aaa bbb ccc", [(0, "a"), (4, "b"), (8, "c")], "  yes no", _idf())
    assert [(p.o, p.c) for p in got] == [(0, "a"), (6, "b")]


def test_strictly_increasing_and_zero_pinned():
    es = [(0, "a"), (10, "b"), (11, "c"), (12, "d")]
    got = place_sections(REF, es, ALT, _idf())
    offs = [p.o for p in got]
    assert offs[0] == 0
    assert offs == sorted(set(offs))


def test_empty_inputs():
    assert place_sections("", [(0, "a")], ALT, _idf()) == []
    assert place_sections(REF, [], ALT, _idf()) == []
    assert place_sections(REF, [(0, "a")], "  ", _idf()) == []


def test_row_refs_folds_continuations_like_the_reader():
    flow = {"turns": [
        {"s": "Socrates", "d": "Soc.", "g": {"c": "5c", "n": 1, "o": 0}, "p": True,
         "e": "First part.", "es": [{"o": 0, "c": "5c"}]},
        # (a) Greek-less residual by the same speaker → continuation
        {"s": "Socrates", "d": None, "g": None, "p": False,
         "e": "Second part.", "es": [{"o": 0, "c": "5d"}]},
        # (b) Greek-bearing, sub-only, same speaker and display → continuation
        {"s": None, "d": None, "g": {"c": "5e", "n": 1, "o": 0}, "p": False, "e": None,
         "sub": [{"s": "Socrates", "d": "Soc.", "e": "Third part.", "es": [{"o": 6, "c": "5e"}]}]},
        {"s": "Euthyphro", "d": "Euth.", "g": {"c": "6a", "n": 1, "o": 0}, "p": True,
         "e": "Reply.", "es": [{"o": 0, "c": "6a"}]},
    ]}
    rr = _row_refs(flow)
    assert set(rr) == {0, 3}
    text, es = rr[0]
    assert text == "First part. Second part. Third part."
    assert es == [(0, "5c"), (12, "5d"), (31, "5e")]
    assert text[31:].startswith("part.")
