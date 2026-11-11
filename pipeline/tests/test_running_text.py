"""The running-text file the search page's running-text mode reads.

Its offset map is implicit: the n-th run of token characters is global token
n, which offsets.json places in a segment and line. These tests pin that the
runs come out one per stage3 token, in order, and round-trip to the segment,
line and token they came from.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "pipeline"))

import pytest  # noqa: E402

from plato_pipeline.running_text import (  # noqa: E402
    build_running_text,
    gap_text,
    line_pieces,
    token_beta,
    token_spans,
)
from plato_pipeline.stage3_tokenize import tokenize  # noqa: E402


def _spine():
    return {
        "work": "Test",
        "segments": [
            {"id": "1:17a", "book": 1, "column": "17a", "lines": [
                {"n": 1, "text": "Ὅτι μὲν ὑμεῖς, ὦ ἄνδρες Ἀθηναῖοι, πεπόνθατε"},
                {"n": 2, "text": "ὑπὸ τῶν ἐμῶν κατηγόρων, οὐκ οἶδα· ἐγὼ δ' οὖν"},
            ]},
            {"id": "1:17b", "book": 1, "column": "17b", "lines": [
                {"n": 1, "text": "[καὶ] ἀ<μφι>γνοεῖν — \"Τί δή;\" ᾧ (ὡς) δοκεῖ."},
                {"n": 2, "text": ""},
            ]},
        ],
    }


def _offsets(segments):
    """offsets.json's coordinates for the same segments, as stage6 counts them."""
    base, running = [], 0
    for seg in segments:
        base.append(running)
        running += sum(len(line["tokens"]) for line in seg["lines"])
    return base, running


def test_token_beta_keeps_marks_in_one_order_and_grave_as_printed():
    assert token_beta("ἔτη") == "e)/th"
    assert token_beta("ᾧ") == "w(=|"
    assert token_beta("ΐ") == "i+/"
    assert token_beta("Ἀθηναῖοι") == "a)qhnai=oi"
    assert token_beta("δὲ") == "de\\"
    assert token_beta("δ'") == "d'"
    assert token_beta("δ’") == "d'"


def test_gap_keeps_punctuation_and_drops_sigla_and_parentheses():
    assert gap_text(", ") == ", "
    assert gap_text("· ") == ": "
    assert gap_text(";\" ") == ";\" "
    assert gap_text(" — ") == " - "
    assert gap_text(" [") == " "
    assert gap_text(") (") == " "
    assert gap_text("  \t ") == " "


def test_line_pieces_cut_the_words_stage3_cuts():
    text = _spine()["segments"][1]["lines"][0]["text"]
    toks = [v for k, v in line_pieces(text) if k == "tok"]
    stage3 = [t["t"] for t in tokenize({"work": "T", "segments": [
        {"id": "x", "book": 1, "column": "x", "lines": [{"n": 1, "text": text}]}]})[0]["segments"][0]["lines"][0]["tokens"]]
    assert toks == stage3 == ["καὶ", "ἀμφιγνοεῖν", "Τί", "δή", "ᾧ", "ὡς", "δοκεῖ"]


def test_running_text_crosses_words_with_their_punctuation():
    spine = _spine()
    segments = tokenize(spine)[0]["segments"]
    text = build_running_text(segments, spine)
    assert text == (
        "o(/ti me\\n u(mei=s, w)= a)/ndres a)qhnai=oi, pepo/nqate u(po\\ tw=n e)mw=n "
        "kathgo/rwn, ou)k oi)=da: e)gw\\ d' ou)=n kai\\ a)mfignoei=n - \"ti/ dh/;\" w(=| w(s dokei="
    )


def test_offset_map_round_trips_to_segment_line_and_token():
    spine = _spine()
    segments = tokenize(spine)[0]["segments"]
    text = build_running_text(segments, spine)
    spans = token_spans(text)
    base, count = _offsets(segments)
    assert len(spans) == count
    for si, seg in enumerate(segments):
        pos = 0
        for line in seg["lines"]:
            for tok in line["tokens"]:
                start, end = spans[base[si] + pos]
                assert text[start:end] == token_beta(tok["t"]), (seg["id"], line["n"], tok)
                pos += 1


def test_a_spine_that_cuts_differently_from_stage3_is_refused():
    spine = _spine()
    segments = tokenize(spine)[0]["segments"]
    spine["segments"][0]["lines"][0]["text"] = "Ὅτι μὲν ὑμεῖς ὦ"
    with pytest.raises(ValueError, match="cuts into"):
        build_running_text(segments, spine)


def test_token_spans_refuses_a_character_neither_word_nor_gap():
    with pytest.raises(ValueError, match="unexpected character"):
        token_spans("lo/gos [kai")


def test_shared_fixture_is_what_the_writer_writes():
    """shared/__tests__ reads this fixture as the file the client loads."""
    fixture = json.loads(
        (ROOT / "pipeline" / "tests" / "fixtures" / "running_text.json").read_text(encoding="utf-8")
    )
    spine = fixture["spine"]
    segments = tokenize(spine)[0]["segments"]
    assert build_running_text(segments, spine) == fixture["running"]["text"]
    assert fixture["running"]["token_count"] == len(token_spans(fixture["running"]["text"]))
