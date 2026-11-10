"""Stage 9's corpus search shards, and the preflight gate that holds them to
the per-work indexes they are copied from.

shared/lib/search.ts runs its matching code on a shard's postings exactly as
it ran it on a work's own index, so the one thing a shard may never do is
differ from that index: a seg_idx that has drifted names the wrong passage.
The gate tests are written failing-case first — each breaks one thing and
expects the gate to name it — and the clean case asserts the gate examined
postings, so a gate that looked at nothing cannot pass.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "pipeline"))

import pytest  # noqa: E402

from plato_pipeline import preflight  # noqa: E402
from plato_pipeline.stage9_search_shards import (  # noqa: E402
    display_spelling, rank_spellings, run, shard_name)

SHARD_FIXTURE = json.loads(
    (ROOT / "pipeline" / "tests" / "fixtures" / "search_shards.json").read_text(encoding="utf-8")
)


@pytest.mark.parametrize("case", SHARD_FIXTURE["cases"], ids=lambda c: c["word"] or "empty")
def test_shard_name_matches_the_shared_fixture(case):
    assert shard_name(case["word"]) == case["shard"]


def _write(path: Path, doc) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")


def _work(dist: Path, work: str, *, lemma, form, english, greek=(), **slots) -> None:
    """greek: the book's Greek tokens as (surface, beta key) pairs; stage9
    reads their spellings for the accents shards."""
    search = dist / work / "search"
    _write(dist / work / "book-01.json", {"segments": [{"id": "1:1a", "greek": [
        {"tokens": [{"t": t, "o": 0, "k": k} for t, k in greek]}]}]})
    _write(search / "meta.json", [{"id": "1:1a", "book": 1, "column": "1a"}])
    _write(search / "greek_lemma.json", lemma)
    _write(search / "greek_form.json", form)
    _write(search / "english.json", english)
    for slot, index in slots.items():
        _write(search / f"english-{slot.replace('_', '-')}.json", index)


def _corpus(tmp_path) -> Path:
    dist = tmp_path / "dist"
    _work(dist, "EN",
          lemma={"logos": [[0, 1]], "kai": [[0, 0], [0, 2]]},
          form={"logou": [[0, 1]], "kai": [[0, 0], [0, 2]]},
          english={"happiness": [[0, 3]], "the": [[0, 0]], "a": [[0, 5]]},
          greek=[("Καὶ", "kai\\"), ("λόγου", "lo/gou"), ("καί", "kai/")],
          third={"happiness": [[0, 1]]},
          overlay_peters={"virtue": [[0, 0]]})
    _work(dist, "Meta",
          lemma={"logos": [[0, 4]]},
          form={"logos": [[0, 4]]},
          english={"happiness": [[0, 2]], "being": [[0, 0]]},
          greek=[("λόγος", "lo/gos"), ("καὶ", "kai\\")])
    run(dist)
    return dist


def _shard(dist: Path, stream: str, name: str) -> dict:
    return json.loads((dist / "search-shards" / stream / f"{name}.json").read_text(encoding="utf-8"))


# -- The stage ---------------------------------------------------------------

def test_a_word_in_every_work_sits_in_one_shard(tmp_path):
    dist = _corpus(tmp_path)
    assert _shard(dist, "english", "ha") == {
        "happiness": {"EN/english": [[0, 3]], "EN/third": [[0, 1]], "Meta/english": [[0, 2]]},
    }
    assert _shard(dist, "lemma", "lo") == {"logos": {"EN": [[0, 1]], "Meta": [[0, 4]]}}
    assert _shard(dist, "form", "lo") == {"logos": {"Meta": [[0, 4]]}, "logou": {"EN": [[0, 1]]}}
    assert _shard(dist, "english", "a_") == {"a": {"EN/english": [[0, 5]]}}
    assert _shard(dist, "english", "vi") == {"virtue": {"EN/overlay-peters": [[0, 0]]}}


def test_the_index_lists_every_shard_and_source(tmp_path):
    dist = _corpus(tmp_path)
    index = json.loads((dist / "search-shards" / "index.json").read_text())
    english = index["streams"]["english"]
    assert english["shards"] == ["a_", "be", "ha", "th", "vi"]
    assert sorted(english["sources"]) == [
        "EN/english", "EN/overlay-peters", "EN/third", "Meta/english"]
    assert sorted(index["streams"]["lemma"]["sources"]) == ["EN", "Meta"]


def test_a_rebuild_drops_shards_no_word_needs_any_more(tmp_path):
    dist = _corpus(tmp_path)
    (dist / "EN" / "search" / "english-overlay-peters.json").unlink()
    run(dist)
    assert not (dist / "search-shards" / "english" / "vi.json").exists()


def test_a_work_without_its_greek_index_is_an_error(tmp_path):
    dist = _corpus(tmp_path)
    (dist / "Meta" / "search" / "greek_form.json").unlink()
    with pytest.raises(ValueError, match="Meta has no search/greek_form.json"):
        run(dist)


def test_vocab_lists_every_form_once_sorted(tmp_path):
    dist = _corpus(tmp_path)
    raw = (dist / "search-shards" / "vocab.json").read_text(encoding="utf-8")
    # The lemma keys too: a pattern with no literal prefix narrows lemma
    # shards with them, and 8,779 lemma keys are not forms.
    assert raw == '{"forms":["kai","logos","logou"],"lemmas":["kai","logos"]}'


def test_accents_are_sharded_like_the_forms_commonest_first(tmp_path):
    dist = _corpus(tmp_path)
    index = json.loads((dist / "search-shards" / "index.json").read_text())
    accents = sorted(p.stem for p in (dist / "search-shards" / "accents").glob("*.json"))
    assert accents == index["streams"]["form"]["shards"] == ["ka", "lo"]
    # Καὶ, καί, καὶ: one spelling, καί, written lower case as most tokens are.
    assert _shard(dist, "accents", "ka") == {"kai": ["καί"]}
    assert _shard(dist, "accents", "lo") == {"logos": ["λόγος"], "logou": ["λόγου"]}


def test_a_form_no_token_spells_is_an_error(tmp_path):
    dist = tmp_path / "dist"
    _work(dist, "EN", lemma={}, form={"logou": [[0, 0]]}, english={},
          greek=[("λόγος", "lo/gos")])
    with pytest.raises(ValueError, match="'logou'"):
        run(dist)


@pytest.mark.parametrize("surface, shown", [
    ("πρὸς", "πρός"),            # grave is the acute of a word before another
    ("ἄνθρωπός", "ἄνθρωπος"),    # an enclitic's extra acute goes, the word's own stays
    ("εἶπέ", "εἶπε"),            # circumflex then acute: the later one goes
    ("ᾗ", "ᾗ"),                  # breathing, circumflex, iota subscript kept
    ("ἀϊδίου", "ἀϊδίου"),        # diaeresis kept
    ("δ'", "δ'"),                # elision apostrophe kept as written
    ("δ’", "δ’"),
    ("Ὅτι", "Ὅτι"),              # case is rank_spellings' business, not this one's
    ("\u03c0\u03c1\u03bf\u0301\u03c2", "πρός"),  # decomposed input comes out NFC
])
def test_display_spelling(surface, shown):
    assert display_spelling(surface) == shown
    assert display_spelling(surface) == __import__("unicodedata").normalize("NFC", shown)


def test_rank_spellings_groups_case_and_puts_the_commonest_first():
    # ὅτι 3 + Ὅτι 2 is one spelling shown lower case; Σωκράτης keeps its capital.
    assert rank_spellings({"Ὅτι": 2, "ὅτι": 3}) == ["ὅτι"]
    assert rank_spellings({"Σωκράτης": 5, "σωκράτης": 1}) == ["Σωκράτης"]
    # The group's count is the sum of its variants: Εἶ 2 + εἶ 2 beats εἰ 3.
    assert rank_spellings({"εἰ": 3, "εἶ": 2, "Εἶ": 2}) == ["εἶ", "εἰ"]
    # Tied groups go alphabetically; a tie inside a group goes to lower case.
    assert rank_spellings({"ἦ": 1, "ἤ": 1}) == ["ἤ", "ἦ"]
    assert rank_spellings({"Ἤ": 1, "ἤ": 1}) == ["ἤ"]


# -- The preflight gate --------------------------------------------------------

def _manifests(*works):
    return [preflight.WorkManifest(work_id=w, path=Path(f"{w}.yaml"), data={}) for w in works]


def _gate(dist, works=("EN", "Meta")):
    problems: list = []
    examined = preflight._validate_search_shards(dist, _manifests(*works), problems)
    return [f"{p[0]}: {p[1]}: {p[2]}" for p in problems], examined


def test_gate_passes_shards_that_match_their_indexes_and_counts_what_it_read(tmp_path):
    problems, examined = _gate(_corpus(tmp_path))
    assert problems == []
    assert examined == 15


def test_gate_reports_missing_shards(tmp_path):
    dist = tmp_path / "dist"
    _work(dist, "EN", lemma={"kai": [[0, 0]]}, form={}, english={})
    problems, _ = _gate(dist, ("EN",))
    assert any("search-shards/index.json" in p and "missing" in p for p in problems), problems


def test_gate_reports_a_missing_vocab(tmp_path):
    dist = _corpus(tmp_path)
    (dist / "search-shards" / "vocab.json").unlink()
    problems, _ = _gate(dist)
    assert any("vocab.json" in p and "missing" in p for p in problems), problems


def test_gate_reports_a_vocab_that_disagrees_with_the_form_index(tmp_path):
    dist = _corpus(tmp_path)
    _write(dist / "search-shards" / "vocab.json", {"forms": ["kai", "logos"]})
    problems, _ = _gate(dist)
    assert any("vocab.json" in p and "'logou'" in p for p in problems), problems


def test_gate_reports_a_form_shard_without_its_accents(tmp_path):
    dist = _corpus(tmp_path)
    (dist / "search-shards" / "accents" / "lo.json").unlink()
    problems, _ = _gate(dist)
    assert any("accents/lo.json" in p and "missing" in p for p in problems), problems


def test_gate_reports_a_shard_older_than_its_index(tmp_path):
    dist = _corpus(tmp_path)
    _write(dist / "Meta" / "search" / "english.json", {"happiness": [[0, 7]], "being": [[0, 0]]})
    problems, _ = _gate(dist)
    assert any("Meta/english" in p and "stale" in p and "happiness" in p for p in problems), problems


def test_gate_reports_a_listed_shard_that_is_missing(tmp_path):
    dist = _corpus(tmp_path)
    (dist / "search-shards" / "english" / "be.json").unlink()
    problems, _ = _gate(dist)
    assert any("english/be.json" in p and "missing" in p for p in problems), problems


def test_gate_reports_a_shard_the_index_does_not_list(tmp_path):
    dist = _corpus(tmp_path)
    _write(dist / "search-shards" / "english" / "zz.json", {"zzz": {"EN/english": [[0, 9]]}})
    problems, _ = _gate(dist)
    assert any("english/zz.json" in p and "not listed" in p for p in problems), problems


def test_gate_reports_a_word_filed_in_the_wrong_shard(tmp_path):
    dist = _corpus(tmp_path)
    shard = _shard(dist, "english", "th")
    shard["being"] = _shard(dist, "english", "be").pop("being")
    _write(dist / "search-shards" / "english" / "th.json", shard)
    _write(dist / "search-shards" / "english" / "be.json", {})
    problems, _ = _gate(dist)
    assert any("'being'" in p and "belongs in be" in p for p in problems), problems


def test_gate_reports_postings_of_a_translation_the_work_does_not_serve(tmp_path):
    """The public build drops a private translation's english-<slot>.json; a
    shard built before that still carries its words in order."""
    dist = _corpus(tmp_path)
    (dist / "EN" / "search" / "english-third.json").unlink()
    problems, _ = _gate(dist)
    assert any("EN/third" in p and "no per-work index" in p for p in problems), problems


def test_gate_reports_a_source_the_shards_lack(tmp_path):
    dist = _corpus(tmp_path)
    _write(dist / "Meta" / "search" / "english-secondary.json", {"being": [[0, 1]]})
    problems, _ = _gate(dist)
    assert any("Meta/secondary" in p and "not in the shards" in p for p in problems), problems


def test_gate_reports_a_hash_the_deploy_check_would_not_match(tmp_path):
    dist = _corpus(tmp_path)
    path = dist / "search-shards" / "index.json"
    index = json.loads(path.read_text())
    index["streams"]["lemma"]["sources"]["EN"] = "0" * 16
    path.write_text(json.dumps(index))
    problems, _ = _gate(dist)
    assert any("EN" in p and "hash" in p for p in problems), problems


def test_gate_reports_a_work_without_its_indexes(tmp_path):
    dist = _corpus(tmp_path)
    (dist / "Meta" / "search" / "greek_lemma.json").unlink()
    problems, _ = _gate(dist)
    assert any("Meta" in p and "search/greek_lemma.json" in p and "missing" in p for p in problems), problems


def test_gate_that_examined_no_postings_says_so(tmp_path):
    dist = tmp_path / "dist"
    _work(dist, "EN", lemma={}, form={}, english={})
    run(dist)
    problems, examined = _gate(dist, ("EN",))
    assert examined == 0
    assert any("examined no postings" in p for p in problems), problems
