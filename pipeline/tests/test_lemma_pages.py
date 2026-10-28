"""Words LSJ prints inside another entry keep their own lexicon page."""

import json

import pytest

from plato_pipeline.stage7_emit import apply_lemma_pages, load_lemma_pages


def _parse(lemma, lsj, gloss="Lacedaemon"):
    return {"lemma": lemma, "gloss": gloss, "parse": "masc nom pl", "lsj": lsj}


def test_an_ethnic_keeps_the_citys_entry_and_gains_its_own_page_and_gloss():
    pages = {"*lakedaimo/nios": {"page": "*lakedaimo/nios", "gloss": "Lacedaemonian"}}
    parses = [_parse("*lakedaimo/nios", ["*la^kedai/mwn"])]
    apply_lemma_pages(parses, pages)
    assert parses == [{
        "lemma": "*lakedaimo/nios", "gloss": "Lacedaemonian", "parse": "masc nom pl",
        "lsj": ["*la^kedai/mwn"], "page": "*lakedaimo/nios",
    }]


def test_a_variant_spelling_files_under_another_lemmas_page():
    pages = {"*surakou/sios": {"page": "*surako/sios"}}
    parses = [_parse("*surakou/sios", ["*su^ra/kousai"], gloss="Syracuse")]
    apply_lemma_pages(parses, pages)
    assert parses[0]["page"] == "*surako/sios"
    assert parses[0]["gloss"] == "Syracuse"  # no curated gloss: Morpheus's stays


def test_other_readings_and_readings_without_an_entry_are_left_alone():
    pages = {"*lakedaimo/nios": {"page": "*lakedaimo/nios"}}
    parses = [_parse("*lakedaimo/nios", []), _parse("*la^kedai/mwn", ["*la^kedai/mwn"])]
    apply_lemma_pages(parses, pages)
    assert all("page" not in p for p in parses)


def test_the_committed_table_loads():
    pages = load_lemma_pages()
    assert pages["ma/lista"]["page"] == "ma/lista"
    assert pages["dianoe/w"]["page"] == "dianoe/omai"


@pytest.mark.parametrize("entry", [
    {"lemma": "x", "page": "x"},                                   # no justification
    {"lemma": "x", "page": "", "justification": "j"},              # empty page
    {"lemma": "x", "page": "x", "justification": "j", "lsj": "y"},  # unknown field
])
def test_the_loader_rejects_a_malformed_entry(tmp_path, entry):
    path = tmp_path / "pages.json"
    path.write_text(json.dumps([entry]))
    with pytest.raises(ValueError):
        load_lemma_pages(path)


def test_the_loader_rejects_a_duplicate_lemma(tmp_path):
    path = tmp_path / "pages.json"
    entry = {"lemma": "x", "page": "x", "justification": "j"}
    path.write_text(json.dumps([entry, entry]))
    with pytest.raises(ValueError):
        load_lemma_pages(path)
