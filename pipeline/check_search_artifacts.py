#!/usr/bin/env python3
"""Re-run the search artifact gates over every emitted Plato work."""

from __future__ import annotations

import argparse
import json
import re
import struct
import sys
from pathlib import Path

from plato_pipeline.stage2_validate import (
    check_grammar,
    check_ngram_artifacts,
    check_ngram_streams,
    check_offsets,
)
from plato_pipeline.stage6_search import signature


ENGLISH_WORD = re.compile(r"[a-z']+")
CHECK_NAMES = ("offsets", "grammar", "ngram-streams")


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def emitted_segments(work_dir: Path) -> list[dict]:
    segments: list[dict] = []
    for path in sorted(work_dir.glob("book-*.json")):
        book = load_json(path)
        for segment in book.get("segments", []):
            segments.append({
                "id": segment["id"],
                "book": book["book"],
                "column": segment["column"],
                "lines": segment["greek"],
            })
    return segments


def english_stream(work_dir: Path) -> tuple[list[str], list[int]]:
    stream: list[str] = []
    bounds: list[int] = []
    for path in sorted(work_dir.glob("book-*.json")):
        book = load_json(path)
        for segment in book.get("segments", []):
            text = (segment.get("english") or {}).get("text") or ""
            words = ENGLISH_WORD.findall(text.lower())
            if not words:
                continue
            bounds.append(len(stream))
            stream.extend(words)
    return stream, bounds


def grammar_column(path: Path, width: int) -> tuple[list[int], int]:
    data = path.read_bytes()
    if width not in (2, 4):
        raise ValueError(f"unsupported grammar width {width}")
    complete_bytes = len(data) - (len(data) % width)
    code = "H" if width == 2 else "I"
    column = [
        value[0]
        for value in struct.iter_unpack(f"<{code}", data[:complete_bytes])
    ]
    return column, len(data) - complete_bytes


def failed(message: str) -> dict:
    return {"ok": False, "problems": [message]}


def check_work(work_dir: Path, build_dir: Path) -> tuple[dict, dict]:
    work = work_dir.name
    search_dir = work_dir / "search"
    segments = emitted_segments(work_dir)
    results: dict[str, dict] = {}

    try:
        offsets = load_json(search_dir / "offsets.json")
        results["offsets"] = check_offsets(offsets, segments)
    except Exception as error:
        offsets = None
        results["offsets"] = failed(f"{type(error).__name__}: {error}")

    try:
        grammar = load_json(search_dir / "grammar-dict.json")
        column, trailing = grammar_column(
            search_dir / "grammar-col.bin", grammar["width"]
        )
        analyses = load_json(work_dir / "analyses.json")
        key_map = {key: key for key in analyses}
        result = check_grammar(
            grammar,
            column,
            offsets,
            segments,
            key_map,
            analyses,
            signature,
            allow_semantic_superset=True,
        )
        if trailing:
            result["problems"].append(
                f"grammar-col.bin has {trailing} trailing byte(s)"
            )
            result["ok"] = False
        results["grammar"] = result
    except Exception as error:
        results["grammar"] = failed(f"{type(error).__name__}: {error}")

    try:
        ngram_doc = load_json(build_dir / "ngrams" / f"{work}.json")
        results["ngram-streams"] = check_ngram_streams(
            ngram_doc["form"],
            ngram_doc["lemma"],
            load_json(search_dir / "greek_form.json"),
            load_json(search_dir / "greek_lemma.json"),
            offsets["seg_base_offset"],
            offsets["token_count"],
        )
    except Exception as error:
        ngram_doc = None
        results["ngram-streams"] = failed(f"{type(error).__name__}: {error}")

    if ngram_doc is not None:
        english, bounds = english_stream(work_dir)
        ngram_doc["english"] = english
        ngram_doc["english_bounds"] = bounds
    return results, ngram_doc


def parse_args() -> argparse.Namespace:
    repo_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(
        description="Check every emitted build/dist/*/search artifact set."
    )
    parser.add_argument(
        "--build",
        type=Path,
        default=repo_root / "build",
        help="build directory (default: <repo>/build)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    build_dir = args.build.resolve()
    work_dirs = sorted(
        path.parent
        for path in (build_dir / "dist").glob("*/search")
        if path.is_dir()
    )
    if not work_dirs:
        print(f"No emitted work search directories under {build_dir / 'dist'}", file=sys.stderr)
        return 2

    totals = {name: {"passed": 0, "failed": 0} for name in CHECK_NAMES}
    work_docs: dict[str, dict] = {}
    failures: list[str] = []
    for work_dir in work_dirs:
        results, ngram_doc = check_work(work_dir, build_dir)
        if ngram_doc is not None:
            work_docs[work_dir.name] = ngram_doc
        for name in CHECK_NAMES:
            result = results[name]
            outcome = "passed" if result["ok"] else "failed"
            totals[name][outcome] += 1
            if not result["ok"]:
                detail = result.get("problems") or ["unknown failure"]
                failures.append(f"{name} {work_dir.name}: {detail[0]}")

    try:
        stage8 = check_ngram_artifacts(build_dir / "dist" / "ngrams", work_docs)
    except Exception as error:
        stage8 = failed(f"{type(error).__name__}: {error}")

    print(f"Works found: {len(work_dirs)}")
    for name in CHECK_NAMES:
        count = totals[name]
        print(f"{name}: {count['passed']} passed, {count['failed']} failed")
    print(
        "ngram-artifacts: "
        f"{1 if stage8['ok'] else 0} passed, {0 if stage8['ok'] else 1} failed"
        f"; {stage8.get('browse_rows', 0)} browse rows, "
        f"{stage8.get('decoded_offsets', 0)} decoded offsets "
        "(full corpus, not sampled)"
    )
    if not stage8["ok"]:
        detail = stage8.get("problems") or ["unknown failure"]
        failures.append(f"ngram-artifacts: {detail[0]}")
    for failure in failures:
        print(f"FAIL {failure}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
