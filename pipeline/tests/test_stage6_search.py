"""Stage 6 offset, morphology, turn-bound, and metadata contracts."""

import json
import struct
from pathlib import Path
from types import SimpleNamespace

from plato_pipeline import stage6_search
from plato_pipeline.stage2_validate import check_offsets
from plato_pipeline.stage6_search import build_turn_bounds, parse_reading, signature


def _line(n, *tokens):
    return {
        "n": n,
        "tokens": [
            {"t": surface, "o": offset, **({"k": key} if key else {})}
            for surface, offset, key in tokens
        ],
    }


def test_offset_arithmetic_round_trips_segment_positions():
    segments = [
        {"id": "1:1a", "book": 1, "column": "1a", "lines": [_line(
            1, ("a", 0, "a"), ("b", 2, "b")
        )]},
        {"id": "2:2a", "book": 2, "column": "2a", "lines": [_line(
            1, ("c", 0, "c"), ("d", 2, None), ("e", 4, "e")
        )]},
    ]
    offsets = {
        "token_count": 5,
        "seg_base_offset": [0, 2],
        "segments": [
            {"book": 1, "column": "1a", "line_runs": [[1, 2]]},
            {"book": 2, "column": "2a", "line_runs": [[1, 3]]},
        ],
        "book_bounds": [{"book": 1, "start": 0}, {"book": 2, "start": 2}],
        "chapter_bounds": [],
        "turn_bounds": [],
    }

    result = check_offsets(offsets, segments)

    assert result["ok"]
    assert result["round_trips_sampled"] == 5


def test_syncretic_values_expand_inside_one_reading():
    assert parse_reading("neut nom/voc/acc pl") == {
        "gender": ["neut"],
        "case": ["acc", "nom", "voc"],
        "number": ["pl"],
    }


def test_participle_and_particle_stay_distinct_without_inferred_pos():
    participle = parse_reading("pres part act masc nom sg")
    particle = parse_reading("(particle)")

    assert participle["mood"] == ["part"]
    assert "marker" not in participle
    assert particle == {"marker": ["particle"]}


def test_grammar_predicates_match_one_whole_reading_not_a_union():
    sig = signature([
        {"parse": "masc nom sg"},
        {"parse": "fem acc pl"},
    ])

    def matches(query):
        return any(
            all(value in dict(reading).get(category, ()) for category, value in query.items())
            for reading in sig
        )

    assert matches({"gender": "masc", "case": "nom", "number": "sg"})
    assert matches({"gender": "fem", "case": "acc", "number": "pl"})
    assert not matches({"gender": "masc", "case": "acc", "number": "sg"})


def test_turn_bounds_align_with_their_book_bounds():
    segments = [
        {"id": "1:1a", "book": 1, "column": "1a", "lines": [_line(
            1, ("alpha", 0, "alpha"), ("beta", 6, "beta")
        )]},
        {"id": "2:2a", "book": 2, "column": "2a", "lines": [_line(
            1, ("gamma", 0, "gamma")
        )]},
    ]
    spine = {
        "segments": [
            {
                "id": "1:1a",
                "book": 1,
                "column": "1a",
                "speakers": [{"line": 1, "offset": 6, "label": "ΣΩ."}],
            },
            {
                "id": "2:2a",
                "book": 2,
                "column": "2a",
                "speakers": [{"line": 1, "offset": 0, "label": "ΚΡ."}],
            },
        ]
    }
    turn_bounds = build_turn_bounds(
        spine, segments, [0, 2], {"ΣΩ.": "Socrates", "ΚΡ.": "Crito"}
    )
    offsets = {
        "token_count": 3,
        "seg_base_offset": [0, 2],
        "segments": [
            {"book": 1, "column": "1a", "line_runs": [[1, 2]]},
            {"book": 2, "column": "2a", "line_runs": [[1, 1]]},
        ],
        "book_bounds": [{"book": 1, "start": 0}, {"book": 2, "start": 2}],
        "chapter_bounds": [],
        "turn_bounds": turn_bounds,
    }

    result = check_offsets(offsets, segments)

    assert result["ok"]
    assert turn_bounds == [
        {"book": 1, "speaker": "Socrates", "start": 1, "accuracy": "exact"},
        {"book": 2, "speaker": "Crito", "start": 2, "accuracy": "exact"},
    ]


def test_stage6_keeps_full_english_chunk_and_aligned_columns(tmp_path, monkeypatch):
    for stage in ("stage1", "stage3", "stage4"):
        (tmp_path / stage).mkdir()
    segments = [
        {
            "id": "1:1a",
            "book": 1,
            "column": "1a",
            "lines": [_line(
                1, ("alpha", 0, "alpha"), ("siglum", 6, None)
            )],
        }
    ]
    english_text = "A" * 620
    (tmp_path / "stage1" / "greek_spine.json").write_text(json.dumps({
        "work": "Test",
        "segments": [
            {"id": "1:1a", "book": 1, "column": "1a", "lines": [], "speakers": []}
        ],
    }))
    (tmp_path / "stage1" / "english_chunks.json").write_text(json.dumps({
        "work": "Test",
        "chunks": [{"id": "1:1a", "book": 1, "column": "1a", "text": english_text}],
    }))
    (tmp_path / "stage3" / "tokens.json").write_text(json.dumps({
        "work": "Test", "segments": segments
    }))
    (tmp_path / "stage4" / "key_map.json").write_text(json.dumps({
        "alpha": "alpha"
    }))
    (tmp_path / "stage4" / "analyses.json").write_text(json.dumps({
        "alpha": [{"lemma": "alpha", "parse": "masc nom sg"}]
    }))
    monkeypatch.setattr(stage6_search, "BUILD_DIR", tmp_path)

    out_dir = stage6_search.run(SimpleNamespace(work_id="Test", data={}))

    meta = json.loads((out_dir / "meta.json").read_text())
    offsets = json.loads((out_dir / "offsets.json").read_text())
    grammar = json.loads((out_dir / "grammar-dict.json").read_text())
    column_data = (out_dir / "grammar-col.bin").read_bytes()
    column = struct.unpack(f"<{len(column_data) // grammar['width']}H", column_data)
    assert meta[0]["english_head"] == english_text
    assert len(meta[0]["english_head"]) > 500
    assert offsets["token_count"] == len(column) == 2
    assert column[1] == grammar["reserved"]["unkeyed"]
    assert json.loads((tmp_path / "ngrams" / "Test.json").read_text())["form"] == [
        "alpha", None
    ]
