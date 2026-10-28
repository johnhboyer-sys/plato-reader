"""Mid-sentence capitals are keyed as names (stage3 prefer_capital_keys)."""

from plato_pipeline.stage3_tokenize import (
    mid_sentence_capitals,
    prefer_capital_keys,
    tokenize,
)


def _spine(*lines: str) -> dict:
    return {
        "work": "Test",
        "segments": [
            {
                "id": "1:1a",
                "book": 1,
                "column": "1a",
                "lines": [{"n": i + 1, "text": t} for i, t in enumerate(lines)],
            }
        ],
    }


def _mid(*lines: str) -> list[str]:
    spine = _spine(*lines)
    tokens, _, _ = tokenize(spine)
    return [tok["t"] for tok in mid_sentence_capitals(tokens, spine)]


def test_a_name_after_a_word_or_comma_is_mid_sentence():
    assert _mid("Ναί, ὦ Θρασύμαχε, καὶ Γλαύκων λέγει.") == ["Θρασύμαχε", "Γλαύκων"]


def test_a_capital_opening_a_speech_or_sentence_is_not():
    # The first word of the work, and words after a stop, a Greek question
    # mark (U+037E and the ASCII ';'), an ano teleia (U+0387 and U+00B7), a
    # colon or a dash.
    assert _mid(
        "Ναί. Δῆλον; Ἴσως; Οἶμαι· Πάνυ· Πῶς: Τί— Οὐ γάρ."
    ) == []


def test_an_opening_quotation_mark_or_bracket_opens_a_speech():
    assert _mid("εἶπον ‘Ναί’ καὶ «Ἴσως» καὶ (Δῆλον).") == []


def test_a_closing_quotation_mark_after_a_stop_does_not_reopen_the_sentence():
    assert _mid("ἔφη ‘οὕτως.’ Ναί.") == []


def test_the_state_carries_across_line_breaks():
    assert _mid("συμβουλεύσει.", "Ναί.") == []
    assert _mid("ὁ δὲ", "Σωκράτης ἔφη.") == ["Σωκράτης"]


def _tok(k: str) -> dict:
    return {"t": "x", "o": 0, "k": k}


def test_rekeys_only_when_both_forms_have_analyses():
    both, lower_only, capital_only = _tok("qrasu/maxe"), _tok("i)/sws"), _tok("glau/kwn")
    present = {"qrasu/maxe", "*qrasu/maxe", "i)/sws", "*glau/kwn"}
    assert prefer_capital_keys([both, lower_only, capital_only], present) == 1
    assert both["k"] == "*qrasu/maxe"
    assert lower_only["k"] == "i)/sws"
    # Stage 4 already falls through to the capital key when the lowercase one
    # is missing, so this token keeps its key.
    assert capital_only["k"] == "glau/kwn"


def test_moves_the_breathing_before_the_letter():
    tok = _tok("e)/rws")
    prefer_capital_keys([tok], {"e)/rws", "*)/erws"})
    assert tok["k"] == "*)/erws"


def test_follows_a_diaeresis_variant_to_its_capital_form():
    tok = _tok("i+/wn")
    prefer_capital_keys([tok], {"i)/wn", "*)/iwn"})
    assert tok["k"] == "*)/iwn"


def test_a_name_derived_from_a_common_word_loses_that_words_gloss():
    from plato_pipeline.stage4_morphology import parse_analysis_line

    readings = parse_analysis_line(
        "{46584999 6 *qrasu/maxos\tbold in battle\tmasc voc sg}"
        "{43638410 9 *zeu/s\tZeus\tmasc acc sg}"
        "{1 6 qrasu/maxos\tbold in battle\tmasc nom sg}"
    )
    assert [r["gloss"] for r in readings] == ["", "Zeus", "bold in battle"]
