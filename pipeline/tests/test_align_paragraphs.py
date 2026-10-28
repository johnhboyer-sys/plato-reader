"""Paragraph mode of the translation aligner (`align_turns`, unit "paragraph").

The unit tests hold the parsing and the DP to hand-built text. The gold set at
the bottom checks rows of the real Republic build whose Jowett slice was read
against Burnet's Greek by hand; it skips when the build or the Jowett payload
isn't there.
"""

from __future__ import annotations

import json

import pytest

from plato_pipeline import align_turns
from plato_pipeline.config import BUILD_DIR


def test_books_are_cut_at_book_heads_inside_the_bounded_body():
    raw = ("Contents\n\n BOOK I.\n\n PERSONS\n\nmute auditors.\n\n BOOK I.\n\n"
           "First para\nwraps.\n\nSecond.\n\n BOOK II.\n\nThird.\n\n*** END OF IT")
    books = align_turns.parse_new_books(raw, {"start_after": "mute auditors.", "end_marker": "*** END"})
    assert books == [["First para wraps.", "Second."], ["Third."]]


def test_atoms_cut_only_near_a_paragraph_edge():
    para = "One. Two. Three. Four. Five. Six. Seven."
    atoms = align_turns._atoms([para])
    assert [a.text for a in atoms] == ["One.", "Two.", "Three. Four. Five.", "Six.", "Seven."]
    assert [a.starts_para for a in atoms] == [True, False, False, False, False]


def test_atoms_keep_a_trailing_attribution_with_its_speech():
    atoms = align_turns._atoms(["And which method do you prefer? I said."])
    assert [a.text for a in atoms] == ["And which method do you prefer? I said."]


def _texts(atoms, runs):
    return [None if r is None else " ".join(a.text for a in atoms[r[0]:r[1]]) for r in runs]


def test_one_paragraph_per_row():
    refs = ["Shall we go down to the harbour today?", "Certainly, said he.",
            "Then the procession of the Thracians was beautiful."]
    paras = ["Shall we go down to the harbour?", "Certainly.",
             "The procession of the Thracians was equally beautiful."]
    atoms, runs, cuts = align_turns.align_paragraphs(refs, paras)
    assert _texts(atoms, runs) == paras
    assert cuts == 0


def test_a_fused_paragraph_is_cut_between_two_rows():
    refs = ["Inquire away, he said.",
            "I will do so, said I. Do you not admit that it is just to obey the rulers?",
            "I do."]
    paras = ["Proceed. I will; and first tell me, do you admit that it is just for subjects to obey their rulers?",
             "I do."]
    atoms, runs, cuts = align_turns.align_paragraphs(refs, paras)
    assert _texts(atoms, runs) == [
        "Proceed.", "I will; and first tell me, do you admit that it is just for subjects to obey their rulers?", "I do."]
    assert cuts == 1


def test_a_row_the_translation_skips_is_left_empty_and_no_text_is_lost():
    refs = ["What is justice, then, according to Simonides?", "Tell me.",
            "Speaking the truth and paying debts is justice, he says."]
    paras = ["What does Simonides say justice is?",
             "That the repayment of debts and speaking truth is justice, he says."]
    atoms, runs, _ = align_turns.align_paragraphs(refs, paras)
    texts = _texts(atoms, runs)
    assert texts[1] is None
    assert [t for t in texts if t] == paras


# ── gold set: hand-checked Republic rows ─────────────────────────────────────
# (book, row index, Stephanus column, start of the Jowett slice, or None for a
# row Jowett folds into its neighbour). Read against the Greek 2026-10-28.
GOLD = [
    (1, 24, "330b", "That was why I asked you the question"),
    (1, 75, "333a", "Or like shoemaking for the acquisition of shoes"),
    (1, 77, "333a", None),
    (1, 202, "338d", "Well, he said, have you never heard"),
    (1, 318, "348b", "And which method do I understand you to prefer? I said."),
    (1, 319, "348b", "That which you propose."),
    (5, 59, "453c", "‘But if so, have you not fallen"),
    (5, 147, "457c", None),
    (5, 149, "457c", "The law, I said, which is the sequel"),
    (5, 548, "479b", "He replied: They are like the punning riddles"),
    (10, 44, "597b", "Well then, here are three beds"),
    (10, 46, "597b", "There is another which is the work of the carpenter?"),
    (10, 222, "607e", "Certainly, he said, we shall be the gainers."),
]


def _book(b):
    p = BUILD_DIR / "dist" / "Republic" / f"book-{b:02d}.json"
    if not p.exists():
        pytest.skip("no Republic build")
    turns = json.loads(p.read_text(encoding="utf-8"))["turnFlow"]["turns"]
    if "jowett" not in (turns[0].get("alt") or {}):
        pytest.skip("Republic build has no Jowett payload (run align_turns)")
    return turns


@pytest.mark.parametrize("book,row,col,start", GOLD)
def test_republic_gold_rows(book, row, col, start):
    t = _book(book)[row]
    assert t["g"]["c"] == col
    e = t["alt"]["jowett"]["e"]
    if start is None:
        assert e is None
    else:
        assert e is not None and e.startswith(start)
