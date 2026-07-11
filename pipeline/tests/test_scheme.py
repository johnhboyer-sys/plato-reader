import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "pipeline"))

from plato_pipeline import scheme as scheme_mod


def test_default_and_named_lookup():
    assert scheme_mod.get(None).name == "bekker"
    assert scheme_mod.get("").name == "bekker"
    assert scheme_mod.get("busse").name == "busse"
    assert scheme_mod.get("stephanus").name == "stephanus"


def test_for_manifest_reads_citation_scheme():
    assert scheme_mod.for_manifest({}).name == "bekker"
    assert scheme_mod.for_manifest({"citation": {"scheme": "stephanus"}}).name == "stephanus"

    class M:
        data = {"citation": {"scheme": "busse"}}

    assert scheme_mod.for_manifest(M()).name == "busse"


def test_bekker_capabilities():
    s = scheme_mod.get("bekker")
    assert s.page_div_type == "Bekker-page"
    assert not s.has_sections
    assert s.bekker_native
    assert s.lines_user_facing
    assert s.validation_mode == "range"
    assert s.range_sides == ("a", "b")
    assert s.compose_column("16a") == "16a"


def test_busse_capabilities_synthesize_a_side_column():
    s = scheme_mod.get("busse")
    assert s.page_div_type == "page"
    assert not s.has_sections
    assert not s.bekker_native
    assert s.validation_mode == "observed"
    assert s.range_sides is None
    assert s.compose_column("1") == "1a"


def test_stephanus_capabilities_compose_page_plus_section():
    s = scheme_mod.get("stephanus")
    assert s.page_div_type == "Stephanus-page"
    assert s.section_div_type == "section"
    assert s.has_sections
    assert not s.bekker_native
    assert not s.lines_user_facing          # Plato cited to the section, not line
    assert s.validation_mode == "observed"
    assert s.range_sides is None            # never enumerate a rectangular range
    assert s.section_letters == ("a", "b", "c", "d", "e")
    assert s.compose_column("2", "a") == "2a"
    assert s.compose_column("17", "e") == "17e"


def test_unknown_scheme_raises():
    with pytest.raises(KeyError):
        scheme_mod.get("nonesuch")
