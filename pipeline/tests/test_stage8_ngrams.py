"""Stage 8 rules: boundaries, recurrence, offsets, and lemma widening."""

import json

from plato_pipeline import stage8_ngrams


def _write_work(tmp_path, work, form, lemma, book_bounds=None, turn_bounds=None):
    (tmp_path / "ngrams").mkdir(exist_ok=True)
    (tmp_path / "dist" / work / "search").mkdir(parents=True, exist_ok=True)
    (tmp_path / "ngrams" / f"{work}.json").write_text(json.dumps({
        "work": work,
        "token_count": len(form),
        "book_bounds": book_bounds or [{"book": 1, "start": 0}],
        "chapter_bounds": [],
        "form": form,
        "lemma": lemma,
    }))
    (tmp_path / "dist" / work / "search" / "offsets.json").write_text(json.dumps({
        "token_count": len(form), "turn_bounds": turn_bounds or [],
    }))


def test_a_phrase_never_spans_a_book_edge():
    stream = [[word] for word in "abcdef"]
    grams = {gram for gram, _ in stage8_ngrams._phrases(stream, [0, 3], 6)}

    assert "b c" in grams
    assert "d e" in grams
    assert "c d" not in grams


def test_only_phrases_recurrent_corpus_wide_are_written(tmp_path, monkeypatch):
    _write_work(tmp_path, "Test", ["a", "b", "c", "a", "b"],
                [["a"], ["b"], ["c"], ["a"], ["b"]])
    monkeypatch.setattr(stage8_ngrams, "BUILD_DIR", tmp_path)

    stage8_ngrams.run()

    browse = json.loads((tmp_path / "dist" / "ngrams" / "form" / "a.json").read_text())
    assert "a b" in browse
    assert "b c" not in browse


def test_occurrence_deltas_round_trip(tmp_path, monkeypatch):
    _write_work(tmp_path, "Test", ["a", "b", "a", "b"],
                [["a"], ["b"], ["a"], ["b"]])
    monkeypatch.setattr(stage8_ngrams, "BUILD_DIR", tmp_path)

    stage8_ngrams.run()

    encoded = json.loads(
        (tmp_path / "dist" / "ngrams" / "form" / "occ" / "a-2.json").read_text()
    )["a b"]["Test"]
    offsets = [encoded[0]]
    for delta in encoded[1:]:
        offsets.append(offsets[-1] + delta)
    assert offsets == [0, 2]


def test_turn_straddles_are_retained_and_counted_for_query_time(tmp_path, monkeypatch):
    _write_work(tmp_path, "Test", ["a", "b", "a", "b"],
                [["a"], ["b"], ["a"], ["b"]],
                turn_bounds=[{"book": 1, "start": 1, "accuracy": "exact"}])
    monkeypatch.setattr(stage8_ngrams, "BUILD_DIR", tmp_path)

    stage8_ngrams.run()

    browse = json.loads((tmp_path / "dist" / "ngrams" / "form" / "a.json").read_text())
    assert browse["a b"][-1] == 1
    assert json.loads(
        (tmp_path / "dist" / "ngrams" / "form" / "occ" / "a-2.json").read_text()
    )["a b"]["Test"] == [0, 2]


def test_lemma_map_widens_a_surface_to_every_headword(tmp_path, monkeypatch):
    _write_work(tmp_path, "Test", ["logou", "logou"],
                [["logos", "lego"], ["logos", "lego"]])
    monkeypatch.setattr(stage8_ngrams, "BUILD_DIR", tmp_path)

    stage8_ngrams.run()

    lemma_map = json.loads((tmp_path / "dist" / "lemma-map" / "l.json").read_text())
    assert lemma_map["logou"] == ["lego", "logos"]
