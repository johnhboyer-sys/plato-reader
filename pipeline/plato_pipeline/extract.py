"""Make the committed Greek line files: python -m plato_pipeline.extract

A LOCAL step, for a machine that has Diogenes and the TLG. It is the only
code in the build's path that runs Diogenes; the build reads what this writes
(corpus/greek/, see greek_lines) and never runs it. HANDOFF-PORTABILITY.md, decision 1.

    python -m plato_pipeline.extract --all
    python -m plato_pipeline.extract --work Euthyphro

For each work: export the TLG author (0059) with Diogenes (verse mode) into
build/export unless that is already there, read the work's lines out of the
export, and write corpus/greek/<Work>.tsv. The export itself, and the TLG's
own files, never enter the repo: build/ is git-ignored and must stay so. The
Diogenes 4.7.2 recipe and its traps are in .claude/skills/tlg-export/SKILL.md.

TLG_DIR names the folder the TLG is in (each manifest's sources.tlg_dir_env).
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

from . import greek_lines
from .config import BUILD_DIR, REPO_ROOT, Manifest

EXPORT_DIR = BUILD_DIR / "export"
_XML_DIR = EXPORT_DIR / "Diogenes-Resources" / "xml" / "tlg"


def exported_xml_path(manifest: Manifest) -> Path:
    w = manifest.data["work"]
    return _XML_DIR / f"tlg{w['tlg_author']}{w['tlg_work']}.xml"


def run_export(manifest: Manifest) -> None:
    """Diogenes xml-export.pl, verse mode (-y), for the work's whole author."""
    # Diogenes 4.7.2 stops with "Could not find user profile dir" without HOME.
    home = os.environ.get("HOME")
    if not home:
        raise RuntimeError("HOME is not set, and Diogenes will not run without it")
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        ["perl", "xml-export.pl", "-c", "tlg", "-n", manifest.data["work"]["tlg_author"],
         "-y", "-o", str(EXPORT_DIR)],
        cwd=manifest.diogenes_server(),
        env={"TLG_DIR": str(manifest.tlg_dir()), "HOME": home, "PATH": "/usr/bin:/bin"},
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Diogenes export failed ({result.returncode}): {result.stderr.strip()[-600:]}")


def ensure_export(manifest: Manifest) -> Path:
    out = exported_xml_path(manifest)
    if out.exists():
        return out
    run_export(manifest)
    if not out.exists():
        raise FileNotFoundError(f"the export ran but {out} is missing")
    return out


def line_file(manifest: Manifest) -> tuple[str, int]:
    """The work's line file as (text, lines), checked; nothing is written."""
    levels = greek_lines.levels_for(manifest)
    rows = greek_lines.rows_from_xml(ensure_export(manifest), levels)
    if not rows:
        raise ValueError(f"{manifest.work_id}: the export holds no lines under {'/'.join(levels)}")
    text = greek_lines.format_tsv(rows, levels, manifest.work_id, manifest.data["work"]["greek_edition"])
    problems = greek_lines.forbidden(text)
    if problems:
        raise ValueError(f"{manifest.work_id}: refusing to write a line file with {problems[:3]}")
    # Read it back before it replaces anything: what the build will read must
    # be what the export says.
    if greek_lines.parse_tsv(text, levels, manifest.work_id) != rows:
        raise ValueError(f"{manifest.work_id}: the line file does not read back as written")
    return text, len(rows)


def lost_lines(manifest: Manifest, lines: int) -> str | None:
    """Why a new file of `lines` lines may not replace the committed one: it
    has fewer. A cut-short export would otherwise shrink a work, and every
    check on the result would still pass."""
    out = greek_lines.corpus_path(manifest)
    if not out.exists():
        return None
    had = len(greek_lines.load(out, greek_lines.levels_for(manifest)))
    if lines >= had:
        return None
    return (f"{manifest.work_id}: the new file has {lines} lines and the committed one {had}; "
            "pass --allow-fewer-lines if the text did lose lines")


def write_all(made: list[tuple[Manifest, str, int]]) -> list[dict]:
    """Replace the committed files, all or none. Every file is first written
    beside its place under a temporary name; only when all are on disk is any
    moved into place, so a write that fails leaves the old files as they were.
    A move that fails part way puts back the files already moved (their old
    bytes are held in memory: the whole corpus is a few MB), each by its own
    write and rename, so one put-back that fails neither truncates a file nor
    stops the others; a file it could not put back is named. extract assumes
    it is the only writer in corpus/greek/ while it runs."""
    staged: list[tuple[Path, Path]] = []
    old: dict[Path, bytes | None] = {}
    moved: list[Path] = []
    try:
        for manifest, text, _lines in made:
            out = greek_lines.corpus_path(manifest)
            out.parent.mkdir(parents=True, exist_ok=True)
            tmp = out.with_suffix(".tsv.tmp")
            staged.append((tmp, out))      # before the write, so a half-written file is removed too
            tmp.write_text(text, encoding="utf-8")
            old[out] = out.read_bytes() if out.exists() else None
        for tmp, out in staged:
            moved.append(out)              # before the move: an interrupt after it must still undo it
            tmp.replace(out)
    except BaseException:
        for tmp, _out in staged:           # first: their space may be what a put-back needs
            tmp.unlink(missing_ok=True)
        lost = []
        for out in moved:
            back = out.with_suffix(".tsv.back")
            try:
                if old[out] is None:
                    out.unlink(missing_ok=True)
                else:
                    back.write_bytes(old[out])
                    back.replace(out)
            except OSError as e:
                lost.append(f"{out}: {e}")
            finally:
                back.unlink(missing_ok=True)
        if lost:
            print("could not put back, so these files may hold the new text: " + "; ".join(lost), file=sys.stderr)
        raise
    return [{"work": m.work_id, "lines": lines, "bytes": len(text.encode("utf-8"))} for m, text, lines in made]


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="plato_pipeline.extract", description=__doc__.split("\n")[0])
    which = parser.add_mutually_exclusive_group(required=True)
    which.add_argument("--work", help="work slug = manifest filename stem")
    which.add_argument("--all", action="store_true", help="every work with a manifest")
    parser.add_argument("--allow-fewer-lines", action="store_true",
                        help="let a new file replace a committed one that has more lines")
    args = parser.parse_args(argv)
    works = [args.work] if args.work else sorted(
        p.stem for p in (REPO_ROOT / "manifests").glob("*.yaml") if not p.stem.endswith("-public"))
    # Make and check every file before the first is written, and write them
    # all or none: a run that fails at the thirtieth work must not leave
    # twenty-nine new files beside old ones.
    made = [(m, *line_file(m)) for m in (Manifest.for_work(w) for w in works)]
    problems = [] if args.allow_fewer_lines else [p for m, _t, n in made if (p := lost_lines(m, n))]
    if problems:
        print("FAIL nothing was written:\n  " + "\n  ".join(problems))
        return 1
    done = write_all(made)
    for counts in done:
        print(f"  {counts['work']}: {counts['lines']} lines, {counts['bytes']} bytes")
    print(f"wrote {len(done)} line files, {sum(c['lines'] for c in done)} lines, "
          f"{sum(c['bytes'] for c in done)} bytes to {greek_lines.CORPUS_DIR}")
    if not done:
        print("wrote nothing")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
