"""stage1_greek_paras — importing Burnet's paragraph POSITIONS onto the spine.

The donor (Perseus's Burnet TEI) and the spine (the TLG export) print the same
edition with different conventions: the donor elides with U+02BC (a Unicode
LETTER, so a naive \\w-based fold keeps it), the spine with an apostrophe; the
donor runs prose continuously, the spine breaks it into numbered lines. Both
differences silently halved the match rate while the mapper "worked", so they
are what these tests pin.
"""
from pathlib import Path

from plato_pipeline import stage1_greek_paras as gp
from plato_pipeline import turns


def _seg(column, lines, book=1):
    return {"id": f"{book}:{column}", "book": book, "column": column,
            "lines": [{"n": i + 1, "text": t} for i, t in enumerate(lines)],
            "speakers": []}


# ── folding ───────────────────────────────────────────────────────────────────

def test_fold_strips_accents_and_maps_back_to_source_offsets():
    folded, idx = gp._fold("Ὦ ἄριστε,")
    assert folded == "ω αριστε "
    # Every folded char points at the source char it came from — that mapping is
    # what turns a text match into a position.
    assert len(folded) == len(idx)
    assert idx[0] == 0 and idx[2] == 2
    assert "Ὦ ἄριστε,"[idx[2]] == "ἄ"


def test_fold_erases_the_elision_mark_in_both_conventions():
    # U+02BC (donor) and U+2019 (spine) must fold to the same string, or every
    # probe containing an elision misses.
    assert gp._fold("ἦ δʼ ὅς")[0] == \
           gp._fold("ἦ δ’ ὅς")[0]


# ── donor parsing ─────────────────────────────────────────────────────────────

_TEI = """<body>
<milestone unit="section" resp="Stephanus" n="449a"/>
alpha beta gamma delta epsilon
<milestone ed="P" unit="para"/><said who="#x">zeta eta theta iota kappa lambda
<milestone n="449b" unit="section" resp="Stephanus"/>mu nu xi omicron pi rho
</body>"""


def test_parse_marks_tracks_sections_whatever_the_attribute_order(tmp_path: Path):
    p = tmp_path / "donor.xml"
    p.write_text(_TEI, encoding="utf-8")
    marks = gp.parse_marks(p)
    assert len(marks) == 1
    section, words = marks[0]
    assert section == "449a"
    # Markup between the mark and the text (here <said>) never enters the probe.
    assert words[:3] == ["zeta", "eta", "theta"]


# ── locating ──────────────────────────────────────────────────────────────────

def test_locate_maps_a_mark_to_a_line_and_offset():
    segs = [_seg("449a", ["alpha beta gamma", "delta zeta eta theta iota"])]
    marks = [("449a", ["zeta", "eta", "theta", "iota"])]
    out, stats = gp.locate(marks, segs)
    assert out == [{"c": "449a", "n": 2, "o": 6}]
    assert stats["located"] == 1 and stats["missed"] == 0


def test_locate_matches_a_probe_that_spans_a_line_break():
    # The OCT wraps mid-sentence, so most probes cross a line join; the join must
    # fold to exactly one space even when the line ends in punctuation.
    segs = [_seg("449a", ["alpha beta gamma.", "delta zeta eta"])]
    out, stats = gp.locate([("449a", ["gamma", "delta", "zeta"])], segs)
    assert out == [{"c": "449a", "n": 1, "o": 11}]
    assert stats["located"] == 1


def test_locate_falls_forward_into_the_next_section():
    # A paragraph opening near a section end has its probe spill across the
    # boundary; the successor section is searched before giving up.
    segs = [_seg("449a", ["alpha beta"]), _seg("449b", ["gamma delta epsilon"])]
    out, stats = gp.locate([("449a", ["beta", "gamma", "delta"])], segs)
    assert out == [{"c": "449a", "n": 1, "o": 6}]
    assert stats["spillover"] == 1


def test_locate_drops_a_mark_it_cannot_place():
    # A wrong position would cut a row mid-clause; the flow's own estimate is a
    # better answer than a confident guess, so an unmatched mark is dropped.
    segs = [_seg("449a", ["alpha beta gamma"])]
    out, stats = gp.locate([("449a", ["nothing", "like", "this"])], segs)
    assert out == []
    assert stats == {"marks": 1, "located": 0, "missed": 1, "spillover": 0}


# ── the flow uses them ────────────────────────────────────────────────────────

def _pchunk(column, text, paras=(), para_start=False, book=1):
    return {"id": f"{book}:{column}", "book": book, "column": column,
            "text": text, "para_start": para_start,
            "markers": [{"kind": "paragraph", "n": "", "offset": o} for o in paras],
            "turns": []}


def test_para_flow_cuts_on_burnet_s_own_paragraph_mark():
    # Without a donor the row's Greek is cut at the proportional estimate; with
    # one it starts at the printed paragraph nearest that estimate instead.
    segs = [_seg("3a", ["Alpha one."]),
            _seg("3b", ["Beta one. Beta two.", "Beta three. Beta four."])]
    chunks = [_pchunk("3a", "Opening.", para_start=True),
              _pchunk("3b", "b1. b2. NEWPARA here.", paras=[8])]
    est, st0 = turns.build_para_flow(segs, chunks)
    assert st0["snapped"] == 0
    marks = [{"c": "3b", "n": 2, "o": 12}]        # "Beta four." — a real break
    snapped, st1 = turns.build_para_flow(segs, chunks, greek_paras=marks)
    assert est["turns"][1]["g"] != {"c": "3b", "n": 2, "o": 12}
    assert snapped["turns"][1]["g"] == {"c": "3b", "n": 2, "o": 12}
    assert st1["snapped"] == 1


def test_para_flow_keeps_the_estimate_in_a_section_with_no_mark():
    segs = [_seg("3a", ["Alpha one."]),
            _seg("3b", ["Beta one. Beta two.", "Beta three. Beta four."])]
    chunks = [_pchunk("3a", "Opening.", para_start=True),
              _pchunk("3b", "b1. b2. NEWPARA here.", paras=[8])]
    est, _ = turns.build_para_flow(segs, chunks)
    # A mark in a DIFFERENT section must not pull this row's anchor: 3b has none,
    # so row 1 keeps its estimate while row 0 (in 3a) snaps.
    other, st = turns.build_para_flow(segs, chunks, greek_paras=[{"c": "3a", "n": 1, "o": 6}])
    assert other["turns"][1]["g"] == est["turns"][1]["g"]
    assert other["turns"][0]["g"] == {"c": "3a", "n": 1, "o": 6}
    assert st["snapped"] == 1


def test_parse_marks_drops_a_speaker_label_from_the_probe(tmp_path: Path):
    # The Phaedo donor reopens a labelled <said> at every page break. A mark
    # opening a short reply at a page end ran into it: "πάνυ γε." + "ΦΑΙΔ." +
    # the next page's words, and no spine line carries the label as text.
    tei = tmp_path / "d.xml"
    tei.write_text(
        '<milestone unit="section" n="64e"/>'
        '<milestone unit="para"/>πάνυ γε. </said></p></div>'
        '<div n="65"><p><said who="#Φαίδων" rend="merge"><label>ΦΑΙΔ.</label> '
        'ἆρ’ οὖν πρῶτον μὲν ἐν τοῖς <milestone unit="page" n="65"/>τοιούτοις',
        encoding="utf-8")
    assert gp.parse_marks(tei) == [
        ("64e", ["πανυ", "γε", "αρ", "ουν", "πρωτον", "μεν", "εν", "τοις"])]


def test_parse_marks_drops_a_tag_the_probe_window_cuts_through(tmp_path: Path):
    tei = tmp_path / "d.xml"
    body = ('<milestone unit="section" n="75e"/>'
            '<milestone unit="para"/>πάνυ γε. ' + "x" * 380 + ' <milestone ed="P" unit="para"/>')
    tei.write_text(body, encoding="utf-8")
    (section, words), *_ = gp.parse_marks(tei)
    assert section == "75e"
    assert "milestone" not in words and "ed" not in words
