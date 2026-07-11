import logging
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "pipeline"))

from plato_pipeline import stage1_stephanus_english
from plato_pipeline.config import Manifest


FIXTURE = Path(__file__).resolve().parent / "fixtures" / "stephanus_english.xml"


def _manifest():
    return Manifest(
        {"work": {"id": "Test"}, "english": {"primary": {"id": "test"}}},
        Path("Test.yaml"),
    )


def test_walks_sections_without_resp_and_assigns_milestone_tail(caplog):
    with caplog.at_level(logging.WARNING):
        english = stage1_stephanus_english.parse_english(FIXTURE, _manifest())
    by_id = {chunk["id"]: chunk for chunk in english["chunks"]}

    assert list(by_id) == ["1:2a", "1:2b", "2:10a", "13:13a"]
    assert by_id["1:2a"]["text"] == "Euthyphro. First text after note. Still first."
    assert by_id["1:2a"]["notes"] == [{"column": "2a", "text": "translator note"}]
    assert by_id["1:2b"]["text"] == "tail for second. Second text."
    assert by_id["2:10a"]["text"] == "Book two text."
    assert by_id["13:13a"]["text"] == "Letter thirteen text."
    assert by_id["1:2b"]["markers"] == []
    assert by_id["1:2b"]["bekker"] == []
    assert "chapters" not in english
    assert "imbedded dialogue" in caplog.text


def test_alignment_reports_both_sides_of_a_section_difference():
    english = stage1_stephanus_english.parse_english(FIXTURE, _manifest())
    spine = {"work": "Test", "segments": [{"id": "1:2a"}, {"id": "1:2c"}]}
    alignment = stage1_stephanus_english.build_alignment(spine, english)
    assert alignment["pairs"] == [
        {"segment": "1:2a", "english": "1:2a"},
        {"segment": "1:2c", "english": None},
    ]
    assert alignment["english_only"] == ["13:13a", "1:2b", "2:10a"]
