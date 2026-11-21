"""The committed line files' format (plato_pipeline.greek_lines).

The failing cases come first: what the reader and the writer must refuse, and
what the check for markup and beta code must catch. Then the claim the build
rests on: a line file gives stage 1 the same spine as the XML it was made from,
speakers' labels and all. The Greek in these cases is made up.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from plato_pipeline import greek_lines as gl
from plato_pipeline import stage1_greek
from plato_pipeline.config import Manifest

TEI = '<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><body>{}</body></text></TEI>'
STEPH = ("Stephanus-page", "section")


def _xml(tmp_path: Path, body: str) -> Path:
    path = tmp_path / "t.xml"
    path.write_text(TEI.format(body), encoding="utf-8")
    return path


def _page(n: str, sections: str) -> str:
    return f'<div type="Stephanus-page" n="{n}">{sections}</div>'


# ---- what rows_from_xml refuses -------------------------------------------

def test_a_section_inside_a_section_is_refused(tmp_path):
    body = _page("2", '<div type="section" n="a"><div type="section" n="b"><l n="1">α</l></div></div>')
    with pytest.raises(ValueError, match="inside another"):
        gl.rows_from_xml(_xml(tmp_path, body), STEPH)


def test_two_sections_in_a_row_with_one_label_are_refused(tmp_path):
    # The file marks a new section only by a change of label: these two would
    # read back as one.
    body = _page("2", '<div type="section" n="a"><l n="1">α</l></div><div type="section" n="a"><l n="2">β</l></div>')
    with pytest.raises(ValueError, match="two divisions in a row"):
        gl.rows_from_xml(_xml(tmp_path, body), STEPH)


def test_a_division_with_no_label_and_a_line_with_an_empty_number_are_refused(tmp_path):
    for sec in ('<div type="section">', '<div type="section" n=" ">'):
        with pytest.raises(ValueError, match="no n"):
            gl.rows_from_xml(_xml(tmp_path, _page("2", sec + '<l n="1">α</l></div>')), STEPH)
    with pytest.raises(ValueError, match="empty n"):
        gl.rows_from_xml(_xml(tmp_path, _page("2", '<div type="section" n="a"><l n="">α</l></div>')), STEPH)


@pytest.mark.parametrize("body", [
    # a wrapper between page and section: the old reader read through it
    '<div type="Stephanus-page" n="2"><div type="wrapper"><div type="section" n="a"><l n="1">α</l></div></div></div>',
    # the levels in another order
    '<div type="section" n="a"><div type="Stephanus-page" n="2"><l n="1">α</l></div></div>',
])
def test_levels_that_do_not_nest_directly_and_in_order_are_refused(tmp_path, body):
    with pytest.raises(ValueError, match="not directly inside"):
        gl.rows_from_xml(_xml(tmp_path, body), STEPH)


@pytest.mark.parametrize("line, message", [
    # a brace is how the file marks a label, so the edition's own would be read as one
    ('<l n="1">λόγος {ΣΩ.} ἔργον</l>', "a brace in the text"),
    ('<l n="1">λόγος <hi>}</hi></l>', "a brace in the text"),
    ('<l n="t">ἐπιστολή {</l>', "a brace in the text"),
    # a label the file could not give back as it was
    ('<l n="1"><label type="speaker">ΣΩ.  ΕΥΘ.</label> λόγος</l>', "speaker label"),
    ('<l n="1"><label type="speaker">ΣΩ.\nΕΥΘ.</label> λόγος</l>', "speaker label"),
    ('<l n="1"><label type="speaker">{ΣΩ.</label> λόγος</l>', "brace|speaker label"),
])
def test_text_the_braces_would_misread_is_refused(tmp_path, line, message):
    with pytest.raises(ValueError, match=message):
        gl.rows_from_xml(_xml(tmp_path, _page("2", f'<div type="section" n="a">{line}</div>')), STEPH)


def test_a_scheme_with_no_line_file_format_is_refused():
    with pytest.raises(ValueError, match="no line file format"):
        gl.levels_for(Manifest({"work": {"id": "T"}, "citation": {"scheme": "bekker"}}, Path("T.yaml")))


# ---- what the writer and the reader refuse ---------------------------------

@pytest.mark.parametrize("row", [
    gl.Row(("2", "a"), "1", "α\tβ"),          # a tab would shift the fields
    gl.Row(("2", "a"), "1", "α\nβ"),          # a line break would make two lines
    gl.Row(("2\ta", "a"), "1", "α"),
    gl.Row(("2", "a"), "1", "α  β"),          # not flat: would not read back the same
    gl.Row(("2",), "1", "α"),                 # one label too few
])
def test_format_refuses_what_would_not_read_back(row):
    with pytest.raises(ValueError):
        gl.format_tsv([row], STEPH, "T", "an edition")


H = "# work: T\n# edition: e\n# columns: Stephanus-page\tsection\tn\ttext\n"


@pytest.mark.parametrize("text, message", [
    ("# work: T\n# edition: e\n# columns: Bekker-page\tn\ttext\n1a\t1\tα\n", "expected # work"),   # another scheme's file
    ("# work: T\n2\ta\t1\tα\n", "expected # work"),                                   # no columns line
    # a fourth heading line is a place to keep anything
    ("# work: T\n# edition: e\n# note: x\n# columns: Stephanus-page\tsection\tn\ttext\n2\ta\t1\tα\n", "expected # work"),
    ("# edition: e\n# work: T\n# columns: Stephanus-page\tsection\tn\ttext\n2\ta\t1\tα\n", "expected # work"),
    # ... and so is a "# " line among the lines of text: it is not skipped
    (H + "# mh=nin\n2\ta\t1\tα\n", "tab-separated fields"),
    (H + "2\ta\t1\n", "tab-separated fields"),
    (H + "2\ta\t1\tα\tβ\n", "tab-separated fields"),
    (H + "\ta\t1\tα\n", "empty label"),
    (H + "2\t\t1\tα\n", "empty label"),
    (H + "2\ta\t1\tα\r\n", "tab-separated fields"),
    (H, "no lines of text"),     # examined nothing
    ("", "expected # work"),
])
def test_parse_refuses_a_file_of_the_wrong_shape(text, message):
    with pytest.raises(ValueError, match=message):
        gl.parse_tsv(text, STEPH)


# ---- the check for markup, beta code, and bytes that are not text ----------

# The Greek dot and question mark, an editor's brackets, a dagger, and two speakers.
CLEAN = H + "2\ta\t1\t{ΣΩ.} Τί λόγος <καὶ> [ἔργον] †ἄλλο· {—ΕΥΘ.} τί;\n"

NOT_GREEK = "characters that are not Greek"
BRACE = "a brace that is not round a speaker's label"


@pytest.mark.parametrize("planted, what", [
    ('2\ta\t2\t<l n="2">λόγος</l>', "markup"),
    ("2\ta\t2\tλόγος</div>", "markup"),
    ('2\ta\t2\t<?xml version="1.0"?>', "markup"),
    ("2\ta\t2\tλόγος &amp; οὐσία", "markup"),
    ("2\ta\t2\tλόγος &#955; οὐσία", "markup"),
    ("2\ta\t2\t<καὶ/>", "markup"),                      # an element with a Greek name
    ('2\ta\t2\t<label type="speaker">ΣΩ.</label> λόγος', "markup"),   # the export's own label
    # beta code: the TLG's own way of writing Greek, in Latin letters
    ("2\ta\t2\tmh=nin a)/eide qea/", NOT_GREEK),
    ("2\ta\t2\t*(omw/numa le/getai", NOT_GREEK),
    ("2\ta\t2\t(mh=nin), (a)/eide), (qea/).", NOT_GREEK),   # punctuation round each word
    ("2\ta\t2\t{*SW.} ti/ ne/on", NOT_GREEK),            # beta code inside the braces
    ("2\ta\t2\tλόγος (A) οὐσία", NOT_GREEK),           # one Latin letter is enough
    ("2\ta\t2\tтекст не греческий", NOT_GREEK),         # another script
    ("2\ta\t2\tthe account of the essence", NOT_GREEK),
    # Latin in another dress: none of these is a "letter" to str.isalpha
    ("2\ta\t2\tλόγος ⓗⓔⓛⓛⓞ", NOT_GREEK),               # circled
    ("2\ta\t2\tλόγος ｈｅｌｌｏ", NOT_GREEK),          # fullwidth
    ("2\ta\t2\tλόγοςͣ", NOT_GREEK),                # a combining Latin a
    ("2\ta\t2\tλόγος 𝛼", NOT_GREEK),                    # a mathematical alpha is not a Greek letter
    ("2\ta\t2\tλόγος ᵞ", NOT_GREEK),               # MODIFIER LETTER SMALL GREEK GAMMA: Greek in name only
    ("2\ta\t2\tλόγος 12", NOT_GREEK),                   # digits belong in the number field
    ("2\ta\t2\tλόγος\rοὐσία", "a control character"),
    ("2\ta\t2\tλόγος\x00οὐσία", "a control character"),
    ("2\ta\t2\tλόγος οὐσία", "a control character"),
    ("2\ta\t1\tm\th\tn\tα", "the wrong number of fields"),   # a word spelled out in spare fields
    ("mhnin\ta\t2\tλόγος", "a label or line number"),     # text hidden in a label
    ("2\tqea\t2\tλόγος", "a label or line number"),
    ("2\ta\ta)/eide\tλόγος", "a label or line number"),
    ("# mh=nin a)/eide qea/", "a label or line number"),  # a "heading" below the heading
    ("λόγος", "a label or line number"),
    # braces that are not a pair round a short label
    ("2\ta\t2\tλόγος { ἔργον", BRACE),
    ("2\ta\t2\tλόγος } ἔργον", BRACE),
    ("2\ta\t2\t{{ΣΩ.}} λόγος", BRACE),
    ("2\ta\t2\t{ΣΩΚΡΑΤΗΣ ΚΑΙ ΕΥΘΥΦΡΩΝ} λόγος", BRACE),   # too long to be a label: a place to keep words
    ("2\ta\tt\t{ΣΩ.} ἐπιστολή", BRACE),                 # stage 1 reads braces only on a numbered line
    ("2\ta\t\t{ΣΩ.} ἐπιστολή", BRACE),
])
def test_forbidden_catches_each_planted_case(planted, what):
    problems = gl.forbidden(CLEAN + planted + "\n")
    assert any(what in p for p in problems), problems


def test_forbidden_catches_one_bad_line_at_the_end_of_a_long_clean_file():
    # No share of the file is allowed to be something else: one line fails it.
    long = CLEAN + "".join(f"2\ta\t{n}\t{{ΣΩ.}} λόγος τῆς οὐσίας ἕτερος\n" for n in range(2, 5000))
    assert gl.forbidden(long) == []
    assert any(NOT_GREEK in p for p in gl.forbidden(long + "2\ta\t5000\t(mh=nin).\n"))


@pytest.mark.parametrize("text", [
    # anything above the three heading lines, in place of them, or between them
    '# <l n="1">mh=nin a)/eide qea/</l>\n' + CLEAN,
    CLEAN.replace("# edition: e\n", "# edition: e\n# mh=nin a)/eide qea/\n"),
    CLEAN.replace("# work: T\n", "# work: mh=nin a)/eide\n"),
    CLEAN.replace("# edition: e\n", "# note: mh=nin a)/eide qea/\n"),
    "# work: T\n# columns: Stephanus-page\tsection\tn\ttext\n",
    "",
])
def test_forbidden_refuses_a_file_that_does_not_open_with_the_three_heading_lines(text):
    assert any("not a line file" in p for p in gl.forbidden(text))


def test_forbidden_checks_the_heading_lines_too():
    assert any("markup" in p for p in gl.forbidden(CLEAN.replace("# edition: e", "# edition: <TEI>e</TEI>")))
    for columns in ("mh=nin a)/eide", "mhnin\tsection\tn\ttext", "Bekker-page\tn\ttext", "Stephanus-page\ttext"):
        assert any("not a line file" in p for p in gl.forbidden(CLEAN.replace("Stephanus-page\tsection\tn\ttext", columns)))


def test_forbidden_passes_greek_a_heading_line_and_a_lacuna():
    assert gl.forbidden(CLEAN) == []
    assert gl.forbidden(H + "309\ta\tt\tΠλάτων φίλῳ εὖ πράττειν.\n2\ta\t1\t* * * λόγος\n") == []


def test_forbidden_fails_a_file_whose_lines_hold_no_letters():
    assert any("no letters" in p for p in gl.forbidden(H + "2\ta\t1\t— * .\n"))


def test_there_is_no_named_exception():
    # Aristotle's guard has one (an editor's cross-reference). Plato's needs
    # none; one added here must come with a test of its own.
    assert gl.NOT_GREEK_OK == {}


# ---- a line file gives stage 1 what the XML gives it -----------------------

def _manifest() -> Manifest:
    data = {"work": {"id": "T", "tlg_author": "9999", "tlg_work": "999", "greek_edition": "e"},
            "citation": {"scheme": "stephanus", "hideLineNumbers": True},
            "books": [{"n": 1, "start": "2a1", "end": "9e99"}]}
    return Manifest(data, Path("T.yaml"))


# A heading line with a head label; a line opened by a speaker; a label in mid
# line with no space after it, one with spaces round it, a dash label, a label
# of two sigla; a hyphen across a section break onto a line whose label must
# shift left; a <pb/>, an <lb/>, and a <hi>.
CASE = (
    _page("2", '<div type="section" n="a"><l n="t"><label type="head">ΤΙΤΛΟΣ ἄλλο</label> </l>'
               '<l n="1"><label type="speaker">ΣΩ.</label> Τί λόγος<label type="speaker">ΕΥ.</label>ἔργον</l>'
               '<l n="2">ἄλλο   <label type="speaker">—</label>  ναί, <label type="speaker">ΝΕ. ΣΩ.</label> πάνυ γε λό-</l></div>'
               '<div type="section" n="b"><l n="1">γος <label type="speaker">ΣΩ.</label> καὶ <pb/>τί<lb/> <hi rend="x">δή</hi></l></div>')
    + _page("3", '<div type="section" n="a"><l n="1">τέλος</l></div>'))

ROWS = [
    gl.Row(("2", "a"), "t", "ΤΙΤΛΟΣ ἄλλο"),
    gl.Row(("2", "a"), "1", "{ΣΩ.} Τί λόγος{ΕΥ.}ἔργον"),
    gl.Row(("2", "a"), "2", "ἄλλο {—} ναί, {ΝΕ. ΣΩ.} πάνυ γε λό-"),
    gl.Row(("2", "b"), "1", "γος {ΣΩ.} καὶ τί δή"),
    gl.Row(("3", "a"), "1", "τέλος"),
]
SPINE = [
    ("1:2a", [(1, "Τί λόγος ἔργον"), (2, "ἄλλο ναί, πάνυ γε λόγος")],
     [{"line": 1, "offset": 0, "label": "ΣΩ."}, {"line": 1, "offset": 9, "label": "ΕΥ."},
      {"line": 2, "offset": 5, "label": "—"}, {"line": 2, "offset": 10, "label": "ΝΕ. ΣΩ."}]),
    ("1:2b", [(1, "καὶ τί δή")], [{"line": 1, "offset": 0, "label": "ΣΩ."}]),
    ("1:3a", [(1, "τέλος")], []),
]


def test_the_line_file_reads_back_and_makes_the_same_spine(tmp_path):
    manifest = _manifest()
    levels = gl.levels_for(manifest)
    xml = _xml(tmp_path, CASE)
    rows = gl.rows_from_xml(xml, levels)
    assert len(rows) == CASE.count("<l ")                 # every line, none dropped
    assert rows == ROWS                                   # written out by hand, above
    text = gl.format_tsv(rows, levels, "T", "e")
    assert gl.parse_tsv(text, levels) == rows
    assert gl.forbidden(text) == []
    tsv = tmp_path / "T.tsv"
    tsv.write_text(text, encoding="utf-8")
    spine = stage1_greek.parse_spine(tsv, manifest)
    assert spine == stage1_greek.parse_spine(xml, manifest)
    # ... and both are the spine a reader of the fixture would write by hand
    assert [(s["id"], [(l["n"], l["text"]) for l in s["lines"]], s.get("speakers", [])) for s in spine["segments"]] == SPINE
    assert spine["headings"] == [{"column": "2a", "text": "ΤΙΤΛΟΣ ἄλλο"}]


def test_a_label_moved_in_the_line_file_moves_in_the_spine(tmp_path):
    # The comparison above would pass a reader that ignored the braces on both
    # sides; this one would not.
    manifest = _manifest()
    rows = list(ROWS)
    rows[1] = gl.Row(("2", "a"), "1", "{ΣΩ.} Τί{ΕΥ.} λόγος ἔργον")
    tsv = tmp_path / "T.tsv"
    tsv.write_text(gl.format_tsv(rows, gl.levels_for(manifest), "T", "e"), encoding="utf-8")
    seg = stage1_greek.parse_spine(tsv, manifest)["segments"][0]
    assert seg["lines"][0]["text"] == "Τί λόγος ἔργον"
    assert {"line": 1, "offset": 3, "label": "ΕΥ."} in seg["speakers"]


def test_a_line_outside_the_works_divisions_is_not_a_row(tmp_path):
    body = '<l n="1">ἔξω</l>' + _page("2", '<div type="section" n="a"><l n="1">ἔσω</l></div>')
    assert gl.rows_from_xml(_xml(tmp_path, body), STEPH) == [gl.Row(("2", "a"), "1", "ἔσω")]


def test_a_bar_in_a_heading_is_dropped_as_the_xml_reader_drops_it(tmp_path):
    # The guard admits no "|" (Burnet's text has none), but stage 1 reads a
    # line file's heading as it reads the export's, should one come.
    manifest = _manifest()
    rows = [gl.Row(("2", "a"), "t", "ΤΙΤΛΟΣ | ἄλλο"), gl.Row(("2", "a"), "1", "λόγος")]
    tsv = tmp_path / "T.tsv"
    tsv.write_text(gl.format_tsv(rows, gl.levels_for(manifest), "T", "e"), encoding="utf-8")
    xml = _xml(tmp_path, _page("2", '<div type="section" n="a"><l n="t">ΤΙΤΛΟΣ | ἄλλο</l><l n="1">λόγος</l></div>'))
    assert stage1_greek.parse_spine(tsv, manifest)["headings"] == [{"column": "2a", "text": "ΤΙΤΛΟΣ ἄλλο"}]
    assert stage1_greek.parse_spine(tsv, manifest) == stage1_greek.parse_spine(xml, manifest)
