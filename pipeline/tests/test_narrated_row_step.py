"""A narrated row's English must translate that row's Greek, not its neighbour's.

Charmides and Lovers were cut on the translator's paragraphs, each row's Greek
snapped to the nearest Burnet mark. Where Lamb broke a paragraph and Burnet
did not, the two sides started in different places: Greek row 153a1 closed
with Chaerephon's question while its English stopped at "grasping me by the
hand—", and row 153b7's English opened with the question. Spine mode (rows on
Burnet's marks, the English cut to match) fixes it. These run on the built
data, so they check what the reader serves.
"""

from __future__ import annotations

import json

import pytest

from plato_pipeline.config import BUILD_DIR, REPO_ROOT


def _rows(work: str) -> list[tuple[str, str]]:
    """(Greek, English) per turnFlow row, the Greek running pin to next pin."""
    path = BUILD_DIR / "dist" / work / "book-01.json"
    if not path.exists():
        pytest.skip(f"no {work} build")
    d = json.loads(path.read_text(encoding="utf-8"))
    flat, idx = [], {}
    for seg in d["segments"]:
        for line in seg["greek"]:
            idx[(seg["column"], line["n"])] = len(flat)
            flat.append(line["text"])
    pins = [(idx[(t["g"]["c"], t["g"]["n"])], t["g"].get("o", 0))
            for t in d["turnFlow"]["turns"]]
    out = []
    for k, t in enumerate(d["turnFlow"]["turns"]):
        (li, o), end = pins[k], pins[k + 1] if k + 1 < len(pins) else None
        parts = []
        for i in range(li, (end[0] if end else len(flat) - 1) + 1):
            a = o if i == li else 0
            b = end[1] if end and i == end[0] else len(flat[i])
            parts.append(flat[i][a:b])
        out.append((" ".join(parts), t.get("e") or ""))
    return out


def _row_with(rows, greek: str) -> tuple[str, str]:
    hits = [r for r in rows if greek in r[0]]
    assert len(hits) == 1, f"{greek!r} in {len(hits)} rows"
    return hits[0]


@pytest.mark.parametrize("work,greek,english", [
    # The reported case: the question and its parenthesis belong to the
    # Greek row that holds them.
    ("Charmides", "πῶς ἐσώθης ἐκ τῆς μάχης", "how did you survive the battle"),
    ("Charmides", "Ὀλίγον δὲ πρὶν ἡμᾶς ἀπιέναι", "Shortly before we came away"),
    # "Immensely so, I replied" sat in the next row's English.
    ("Charmides", "Ὑπερφυῶς, ἦν δ' ἐγώ", "Immensely so, I replied"),
])
def test_english_sits_with_its_greek(work, greek, english):
    g, e = _row_with(_rows(work), greek)
    assert english in e, f"{work}: row with {greek!r} has English {e[:120]!r}"


@pytest.mark.parametrize("work,greek,opening", [
    # Lovers 138e/139a: "I agree" (Δοκεῖ μοι) opened the next row's English.
    ("Lovers", "Πολλοῦ ἄρα δεῖ ἡμῖν", "Hence we see"),
    ("Charmides", "Καὶ ἐγὼ πρὸς αὐτὸν ἀποκρινόμενος", "In the state in which"),
    # 161c: needs Critias/Charmides in para_align's name table to pair
    # "said Critias" and "said Charmides" with their Greek attributions.
    ("Charmides", "Ἔοικεν, ἔφη ὁ Κριτίας, ἄλλου", "Seemingly, said Critias"),
    ("Charmides", "Ἀλλὰ τί διαφέρει, ἦ δ' ὅς, ὁ Χαρμίδης", "But what does it matter"),
])
def test_row_english_opens_with_its_greek(work, greek, opening):
    g, e = _row_with(_rows(work), greek)
    if g.startswith(greek):
        assert e.startswith(opening), f"{work}: row {greek!r} opens {e[:80]!r}"
    else:
        pytest.fail(f"{work}: {greek!r} is not a row start")


@pytest.mark.parametrize("work", ["Charmides", "Lovers"])
def test_spine_mode_declared(work):
    text = (REPO_ROOT / "manifests" / f"{work}.yaml").read_text(encoding="utf-8")
    assert "spine: true" in text
