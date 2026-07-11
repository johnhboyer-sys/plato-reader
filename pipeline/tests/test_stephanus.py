"""Stephanus (Plato) citation-scheme pipeline: spine parse, observed-mode
validation, and sections.json emission."""

import json
import hashlib
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "pipeline"))

from plato_pipeline import stage1_greek, stage2_validate, stage7_emit
from plato_pipeline.config import Manifest

FIX = Path(__file__).resolve().parent / "fixtures" / "stephanus"


def _manifest(books, gaps=None):
    data = {
        "work": {"id": "Euthyphro", "greek_edition": "Burnet OCT"},
        "citation": {"scheme": "stephanus", "hideLineNumbers": True},
        "books": books,
    }
    if gaps is not None:
        data["expected_section_gaps"] = gaps
    return Manifest(data, Path("Euthyphro.yaml"))


# --- spine parse: real Euthyphro 2-page fixture ------------------------------

def test_euthyphro_fixture_columns_and_lines():
    m = _manifest([{"n": 1, "start": "2a1", "end": "3e10"}])
    spine = stage1_greek.parse_spine(FIX / "euthyphro_p2_3.xml", m)
    cols = [s["column"] for s in spine["segments"]]
    # Page 2 carries only a-d in Burnet's edition (interior pages need not
    # hold every letter); page 3 carries a-e. Reading order.
    assert cols == ["2a", "2b", "2c", "2d", "3a", "3b", "3c", "3d", "3e"]
    assert all(s["id"] == f"1:{s['column']}" for s in spine["segments"])
    assert spine["unassigned_lines"] == []
    # Lines restart at 1 per section.
    by_col = {s["column"]: s for s in spine["segments"]}
    assert by_col["2a"]["lines"][0]["n"] == 1
    assert by_col["2b"]["lines"][0]["n"] == 1


def test_euthyphro_fixture_excludes_speaker_labels_from_text():
    m = _manifest([{"n": 1, "start": "2a1", "end": "3e10"}])
    spine = stage1_greek.parse_spine(FIX / "euthyphro_p2_3.xml", m)
    by_col = {s["column"]: s for s in spine["segments"]}
    # 2a line 1 opens a ΕΥΘ. turn; the label is NOT in the token stream.
    l1 = by_col["2a"]["lines"][0]
    assert l1["text"].startswith("Τί νεώτερον")
    assert "ΕΥΘ" not in l1["text"] and "\x00" not in l1["text"]
    speakers = by_col["2a"]["speakers"]
    assert {"line": 1, "offset": 0, "label": "ΕΥΘ."} in speakers
    assert {"line": 5, "offset": 0, "label": "ΣΩ."} in speakers


def test_euthyphro_fixture_hyphen_rejoin_within_section():
    # 3a lines 1-2: 'διαφθεί-' + 'ροντας' must rejoin to 'διαφθείροντας'.
    m = _manifest([{"n": 1, "start": "2a1", "end": "3e10"}])
    spine = stage1_greek.parse_spine(FIX / "euthyphro_p2_3.xml", m)
    a3 = {s["column"]: s for s in spine["segments"]}["3a"]
    assert a3["lines"][0]["text"].endswith("διαφθείροντας,")
    assert a3["lines"][0].get("joined") is True


# --- spine parse: synthetic edge cases ---------------------------------------

def test_edge_fixture_covers_start_missing_letter_speaker_and_hyphens():
    m = _manifest([{"n": 1, "start": "5c1", "end": "6a2"}])
    spine = stage1_greek.parse_spine(FIX / "edge_cases.xml", m)
    by_col = {s["column"]: s for s in spine["segments"]}

    # Mid-page work start (first section is 5c, not 5a) and a missing letter (no 5d).
    assert [s["column"] for s in spine["segments"]] == ["5c", "5e", "6a"]

    # Hyphen across a SECTION boundary: 5c 'τρί-' + 5e 'τος' -> 'τρίτος'.
    assert by_col["5c"]["lines"][1]["text"].endswith("τρίτος")
    assert by_col["5c"]["lines"][1]["joined"] is True

    # Hyphen across a PAGE boundary: 5e 'πε-' + 6a 'ραίνω' -> 'περαίνω'.
    assert by_col["5e"]["lines"][1]["text"].endswith("περαίνω")
    assert by_col["6a"]["lines"][0]["text"].startswith("ταῦτα")

    # Speaker mid-section: ΕΥΘ. begins mid-line, and its offset survives the
    # hyphen rejoin that consumed the line's first word ('τος').
    l1 = by_col["5e"]["lines"][0]
    assert l1["text"] == "ἔστω. καλῶς λέγεις"
    assert by_col["5e"]["speakers"] == [{"line": 1, "offset": 6, "label": "ΕΥΘ."}]
    assert l1["text"][6:] == "καλῶς λέγεις"   # offset points at the speech start


# --- validator: observed-spine mode ------------------------------------------

def _empty_sides():
    return {"chunks": []}, {"pairs": [], "english_only": []}


def _set_spine_baseline(manifest, spine):
    columns = []
    for segment in spine["segments"]:
        if not columns or columns[-1] != segment["column"]:
            columns.append(segment["column"])
    manifest.data["section_spine"] = {
        "count": len(columns),
        "sha256": hashlib.sha256(",".join(columns).encode()).hexdigest(),
    }


def _validate(manifest, spine, english, alignment):
    _set_spine_baseline(manifest, spine)
    return stage2_validate.validate(manifest, spine, english, alignment)


def test_validator_accepts_euthyphro_fixture():
    m = _manifest([{"n": 1, "start": "2a1", "end": "3e10"}])
    spine = stage1_greek.parse_spine(FIX / "euthyphro_p2_3.xml", m)
    english, alignment = _empty_sides()
    report = _validate(m, spine, english, alignment)
    assert report["ok"] is True
    so = report["checks"]["section_order"]
    assert so["strictly_increasing"] is True
    assert so["gaps"] == []
    # observed mode: expected == observed, no rectangular enumeration.
    assert report["checks"]["columns"]["found"] == report["checks"]["columns"]["expected"]


def test_validator_rejects_removed_interior_section_against_baseline():
    m = _manifest([{"n": 1, "start": "2a1", "end": "3e10"}])
    spine = stage1_greek.parse_spine(FIX / "euthyphro_p2_3.xml", m)
    _set_spine_baseline(m, spine)
    spine["segments"] = [s for s in spine["segments"] if s["column"] != "3c"]

    english, alignment = _empty_sides()
    report = stage2_validate.validate(m, spine, english, alignment)
    check = report["checks"]["section_spine"]
    assert report["ok"] is False
    assert check["count_match"] is False
    assert check["hash_match"] is False
    assert check["expected"]["count"] == 9
    assert check["got"]["count"] == 8
    assert check["first_diverging_token"] == {"index": 6, "token": "3d", "after": "3b"}


def test_validator_reports_missing_letter_as_info_gap():
    m = _manifest([{"n": 1, "start": "5c1", "end": "6a2"}])
    spine = stage1_greek.parse_spine(FIX / "edge_cases.xml", m)
    english, alignment = _empty_sides()
    report = _validate(m, spine, english, alignment)
    so = report["checks"]["section_order"]
    # 5c -> 5e skips 5d: reported as an informational gap but still OK.
    assert so["ok"] is True
    assert {"after": "5c", "next": "5e", "expected": False} in so["gaps"]
    # Declaring the gap flips its 'expected' flag.
    m2 = _manifest([{"n": 1, "start": "5c1", "end": "6a2"}],
                   gaps=[{"after": "5c", "next": "5e"}])
    report2 = _validate(m2, spine, english, alignment)
    assert {"after": "5c", "next": "5e", "expected": True} in \
        report2["checks"]["section_order"]["gaps"]


def test_validator_flags_out_of_order_sections():
    m = _manifest([{"n": 1, "start": "2a1", "end": "3e10"}])
    spine = stage1_greek.parse_spine(FIX / "euthyphro_p2_3.xml", m)
    # Corrupt the spine: move 3a before 2e so columns are not strictly increasing.
    segs = spine["segments"]
    i2d = next(k for k, s in enumerate(segs) if s["column"] == "2d")
    i3a = next(k for k, s in enumerate(segs) if s["column"] == "3a")
    segs.insert(i2d, segs.pop(i3a))
    english, alignment = _empty_sides()
    report = _validate(m, spine, english, alignment)
    assert report["checks"]["section_order"]["strictly_increasing"] is False
    assert report["checks"]["section_order"]["ok"] is False
    assert report["ok"] is False


# --- validator: book partition (section scheme) ------------------------------

def _spine(columns):
    return {
        "work": "Euthyphro",
        "segments": [
            {"id": f"x:{c}", "book": 1, "column": c, "lines": [{"n": 1, "text": "ω"}]}
            for c in columns
        ],
    }


def test_book_partition_accepts_a_clean_two_book_spine():
    m = _manifest([{"n": 1, "start": "2a", "end": "3e"},
                   {"n": 2, "start": "4a", "end": "5e"}])
    # 3e is the boundary section (last of book 1); 4a first of book 2.
    spine = _spine(["2a", "3e", "4a", "5e"])
    english, alignment = _empty_sides()
    report = _validate(m, spine, english, alignment)
    bp = report["checks"]["book_partition"]
    assert bp["ok"] is True
    assert bp["books"] == 2
    assert bp["ordered_non_overlapping"] is True
    assert bp["sections_outside_any_book"] == []
    assert bp["sections_in_multiple_books"] == []


def test_book_partition_flags_section_outside_any_book():
    m = _manifest([{"n": 1, "start": "2a", "end": "3e"},
                   {"n": 2, "start": "4a", "end": "5e"}])
    spine = _spine(["2a", "3e", "4a", "5e", "9a"])  # 9a is outside every range
    english, alignment = _empty_sides()
    report = _validate(m, spine, english, alignment)
    bp = report["checks"]["book_partition"]
    assert bp["sections_outside_any_book"] == ["9a"]
    assert bp["ok"] is False
    assert report["ok"] is False


def test_book_partition_flags_overlapping_ranges():
    m = _manifest([{"n": 1, "start": "2a", "end": "4b"},
                   {"n": 2, "start": "4a", "end": "5e"}])  # 4a..4b overlap
    spine = _spine(["2a", "4a", "4b", "5e"])
    english, alignment = _empty_sides()
    report = _validate(m, spine, english, alignment)
    bp = report["checks"]["book_partition"]
    assert bp["ordered_non_overlapping"] is False
    # 4a and 4b are claimed by both books.
    assert bp["sections_in_multiple_books"] == ["4a", "4b"]
    assert bp["ok"] is False


# --- stage7: sections.json emission ------------------------------------------

def test_emit_sections_orders_columns_per_book(tmp_path):
    m = _manifest([{"n": 1, "start": "2a1", "end": "3e10"}])
    spine = stage1_greek.parse_spine(FIX / "euthyphro_p2_3.xml", m)
    out = stage7_emit.emit_sections(spine, tmp_path)
    written = json.loads((tmp_path / "sections.json").read_text(encoding="utf-8"))
    assert written == out
    assert list(written.keys()) == ["1"]
    sections = written["1"]
    assert [s["column"] for s in sections] == \
        ["2a", "2b", "2c", "2d", "3a", "3b", "3c", "3d", "3e"]
    assert sections[0] == {"column": "2a", "page": 2, "letter": "a", "id": "1:2a"}
    assert sections[-1] == {"column": "3e", "page": 3, "letter": "e", "id": "1:3e"}


def test_stage7_unmapped_siglum_fails_before_any_book_is_written(tmp_path, monkeypatch):
    build = tmp_path / "build"
    (build / "stage1").mkdir(parents=True)
    (build / "stage3").mkdir()
    spine = {
        "segments": [{
            "id": "1:2a", "book": 1, "column": "2a", "lines": [],
            "speakers": [{"line": 1, "offset": 0, "label": "ΧΧ."}],
        }]
    }
    (build / "stage1" / "greek_spine.json").write_text(json.dumps(spine))
    (build / "stage1" / "english_chunks.json").write_text(
        json.dumps({"chunks": [{"id": "1:2a", "turns": []}]})
    )
    (build / "stage3" / "tokens.json").write_text(json.dumps({"segments": []}))
    old_book = build / "dist" / "Euthyphro" / "book-01.json"
    old_book.parent.mkdir(parents=True)
    old_book.write_text("verified previous emission")
    monkeypatch.setattr(stage7_emit, "BUILD_DIR", build)

    m = _manifest([{"n": 1, "start": "2a1", "end": "2a99"}])
    m.data["speakers"] = {"sigla": {"ΣΩ.": "Socrates"}}
    with pytest.raises(RuntimeError, match=r"Euthyphro.*1:2a.*ΧΧ\."):
        stage7_emit.run(m)
    assert old_book.read_text() == "verified previous emission"
