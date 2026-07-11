import logging
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "pipeline"))

from lxml import etree

from plato_pipeline import stage1_stephanus_english
from plato_pipeline.config import Manifest


FIXTURE = Path(__file__).resolve().parent / "fixtures" / "stephanus_english.xml"


def _manifest(books=None):
    data = {"work": {"id": "Test"}, "english": {"primary": {"id": "test"}}}
    if books is not None:
        data["books"] = books
    return Manifest(data, Path("Test.yaml"))


def _parse(xml: str, books=None):
    """Parse an inline TEI body string through the walker."""
    body = etree.fromstring(
        '<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><body>'
        + xml
        + "</body></text></TEI>"
    ).find(".//{*}body")
    walker = stage1_stephanus_english._Walker((books or [{"n": 1}]))
    walker.walk(body)
    for chunk in walker.chunks:
        from plato_pipeline.stage1_common import collapse_ws

        chunk["text"] = collapse_ws(chunk["text"]).strip()
    return [c for c in walker.chunks if c["text"] or c["notes"]]


# --- bookless: every section folds into book 1 -------------------------------

def test_bookless_folds_all_divisions_into_book_one(caplog):
    # No books table -> bookless: the book/letter divs are ignored, so the
    # section under div n="2" and div n="13" both land in book 1.
    with caplog.at_level(logging.WARNING):
        english = stage1_stephanus_english.parse_english(FIXTURE, _manifest())
    by_id = {chunk["id"]: chunk for chunk in english["chunks"]}

    assert list(by_id) == ["1:2a", "1:2b", "1:10a", "1:13a"]
    assert by_id["1:2a"]["text"] == "Euthyphro. First text after note. Still first."
    assert by_id["1:2a"]["notes"] == [{"column": "2a", "text": "translator note"}]
    assert by_id["1:2b"]["text"] == "tail for second. Second text."
    assert by_id["1:10a"]["text"] == "Book two text."
    assert by_id["1:13a"]["text"] == "Letter thirteen text."
    assert by_id["1:2b"]["markers"] == []
    assert by_id["1:2b"]["bekker"] == []
    assert "chapters" not in english
    assert "imbedded dialogue" in caplog.text


def test_bookless_merges_a_section_straddling_a_letter_boundary():
    # Letters splits a Stephanus page across two letter divs: the SAME section
    # token repeats. Bookless keying (1, token) merges the two fragments, in
    # document order, into one chunk -> id parity with the one-per-page Greek.
    chunks = _parse(
        '<div subtype="letter" n="1">'
        '  <milestone n="309a" unit="section"/><p>Letter one.</p>'
        '  <milestone n="310b" unit="section"/><p>First half.</p>'
        "</div>"
        '<div subtype="letter" n="2">'
        '  <milestone n="310b" unit="section"/><p>Second half.</p>'
        '  <milestone n="311a" unit="section"/><p>Letter two.</p>'
        "</div>"
    )
    by_id = {c["id"]: c for c in chunks}
    assert list(by_id) == ["1:309a", "1:310b", "1:311a"]
    assert by_id["1:310b"]["text"] == "First half. Second half."


# --- multibook: divisions mapped by ORDER ------------------------------------

def test_multibook_maps_divisions_by_order():
    books = [{"n": 1, "start": "5a"}, {"n": 2, "start": "8a"}]
    chunks = _parse(
        '<div subtype="book" n="1">'
        '  <milestone n="5a" unit="section"/><p>One alpha.</p>'
        '  <milestone n="5b" unit="section"/><p>One beta.</p>'
        "</div>"
        '<div subtype="book" n="2">'
        '  <milestone n="8a" unit="section"/><p>Two alpha.</p>'
        "</div>",
        books=books,
    )
    assert [c["id"] for c in chunks] == ["1:5a", "1:5b", "2:8a"]


def test_multibook_uses_order_not_div_n():
    # The div @n values (7, 9) are ignored; ORDER assigns books 1 and 2.
    books = [{"n": 1, "start": "5a"}, {"n": 2, "start": "8a"}]
    chunks = _parse(
        '<div subtype="book" n="7">'
        '  <milestone n="5a" unit="section"/><p>alpha.</p></div>'
        '<div subtype="book" n="9">'
        '  <milestone n="8a" unit="section"/><p>beta.</p></div>',
        books=books,
    )
    assert [c["id"] for c in chunks] == ["1:5a", "2:8a"]


def test_multibook_warns_on_book_start_mismatch(caplog):
    books = [{"n": 1, "start": "5a"}, {"n": 2, "start": "9a"}]  # 9a != actual 8a
    with caplog.at_level(logging.WARNING):
        _parse(
            '<div subtype="book" n="1">'
            '  <milestone n="5a" unit="section"/><p>a.</p></div>'
            '<div subtype="book" n="2">'
            '  <milestone n="8a" unit="section"/><p>b.</p></div>',
            books=books,
        )
    assert "!= manifest start" in caplog.text


def test_alignment_reports_both_sides_of_a_section_difference():
    english = stage1_stephanus_english.parse_english(FIXTURE, _manifest())
    spine = {"work": "Test", "segments": [{"id": "1:2a"}, {"id": "1:2c"}]}
    alignment = stage1_stephanus_english.build_alignment(spine, english)
    assert alignment["pairs"] == [
        {"segment": "1:2a", "english": "1:2a"},
        {"segment": "1:2c", "english": None},
    ]
    assert alignment["english_only"] == ["1:10a", "1:13a", "1:2b"]
