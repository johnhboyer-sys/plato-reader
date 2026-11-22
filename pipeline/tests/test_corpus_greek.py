"""The guard on the committed Greek (corpus/greek/).

Two promises. The build needs nothing but these files for a work's Greek, so
each work has one and stage 1 never runs Diogenes. And the files hold lines of
Greek and nothing of the TLG's own: no beta code, no Diogenes XML. The check
(greek_lines.forbidden) has its planted failing cases in test_greek_lines.py;
here it runs over the files themselves, and says how many it read.
"""

from __future__ import annotations

import re
from pathlib import Path
import subprocess

import pytest

from plato_pipeline import extract, greek_lines, stage1_greek
from plato_pipeline.config import REPO_ROOT, Manifest

WORKS = sorted(p.stem for p in (REPO_ROOT / "manifests").glob("*.yaml") if not p.stem.endswith("-public"))


def test_the_guard_has_something_to_guard():
    # A check that examined nothing has not passed.
    assert len(WORKS) >= 36, WORKS


def test_the_folder_holds_one_file_per_work_and_nothing_else():
    have = sorted(p.name for p in greek_lines.CORPUS_DIR.iterdir())
    assert have == sorted(["README.md", *(f"{w}.tsv" for w in WORKS)])
    assert all(p.is_file() and not p.is_symlink() for p in greek_lines.CORPUS_DIR.iterdir())


def test_the_readme_is_short_and_holds_no_markup():
    # The one file here the character rule cannot cover: it is English prose.
    # This holds it to a page (no export fits in 4 KB) and to no XML; that its
    # words are what they should be is for whoever reviews a change to it.
    readme = (greek_lines.CORPUS_DIR / "README.md").read_text(encoding="utf-8")
    assert 500 < len(readme.encode("utf-8")) < 4096, "the README has grown; nothing but a short page belongs there"
    assert not re.search(r"<\?xml|<TEI|<div|<l[ >]|</|xmlns", readme)
    assert "TLG" not in readme and "Diogenes" not in readme


@pytest.mark.parametrize("work", WORKS)
def test_each_file_is_lines_of_greek_under_its_own_heading(work):
    manifest = Manifest.for_work(work)
    path = greek_lines.corpus_path(manifest)
    text = path.read_text(encoding="utf-8")
    assert greek_lines.forbidden(text) == []
    rows = greek_lines.parse_tsv(text, greek_lines.levels_for(manifest), path.name)
    assert len(rows) >= 50, f"{work}: only {len(rows)} lines"
    head = text.split("\n")[:2]
    assert head == [f"# work: {work}", "# edition: " + " ".join(manifest.data["work"]["greek_edition"].split())]
    # The licence page names editions; these files do the same and never name
    # the disc the text was read from.
    assert "TLG" not in text and "Thesaurus Linguae" not in text and "Diogenes" not in text


def test_the_whole_corpus_was_read(capsys):
    files = lines = labels = 0
    for w in WORKS:
        m = Manifest.for_work(w)
        rows = greek_lines.load(greek_lines.corpus_path(m), greek_lines.levels_for(m))
        files += 1
        lines += len(rows)
        labels += sum(len(greek_lines.SPEAKER.findall(r.text)) for r in rows)
    with capsys.disabled():
        print(f"\ncorpus/greek guard: read {files} files, {lines} lines, {labels} speakers' labels")
    assert files == len(WORKS) and lines > 70_000 and labels > 12_000, (files, lines, labels)


def test_stage_1_stops_on_a_missing_line_file_and_does_not_run_diogenes(tmp_path, monkeypatch):
    monkeypatch.setattr(greek_lines, "CORPUS_DIR", tmp_path)
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: pytest.fail("the build ran a program"))
    with pytest.raises(FileNotFoundError, match="plato_pipeline.extract --work Euthyphro"):
        stage1_greek.run(Manifest.for_work("Euthyphro"))
    # and it has no way to: the export call lives in extract alone
    assert not hasattr(stage1_greek, "subprocess") and not hasattr(stage1_greek, "run_export")


def test_the_export_folder_cannot_be_committed():
    # extract writes the Diogenes XML under build/export; git must ignore it.
    r = subprocess.run(["git", "check-ignore", "-q", str(extract.EXPORT_DIR / "Diogenes-Resources" / "xml" / "tlg" / "tlg0059001.xml")],
                       cwd=REPO_ROOT)
    assert r.returncode == 0, "build/export is not git-ignored"
    tracked = subprocess.run(["git", "ls-files", "build", "*Diogenes-Resources*"], cwd=REPO_ROOT, capture_output=True, text=True)
    assert tracked.returncode == 0, tracked.stderr
    assert tracked.stdout == "", tracked.stdout[:400]
    # and git did answer: the same question about a folder it does track
    assert subprocess.run(["git", "ls-files", "manifests"], cwd=REPO_ROOT, capture_output=True, text=True).stdout


def _export(tmp_path, lines: int, text: str = "λόγος"):
    xml = tmp_path / f"x{lines}.xml"
    xml.write_text('<TEI><body><div type="Stephanus-page" n="2"><div type="section" n="a">'
                   + "".join(f'<l n="{n}">{text}</l>' for n in range(1, lines + 1)) + "</div></div></body></TEI>",
                   encoding="utf-8")
    return xml


def test_extract_refuses_to_write_a_file_the_guard_would_fail(tmp_path, monkeypatch):
    monkeypatch.setattr(greek_lines, "CORPUS_DIR", tmp_path / "out")
    monkeypatch.setattr(extract, "ensure_export", lambda m: _export(tmp_path, 1, "mh=nin a)/eide qea/"))
    with pytest.raises(ValueError, match="refusing"):
        extract.main(["--work", "Euthyphro"])
    assert not (tmp_path / "out").exists()


def test_extract_will_not_replace_a_file_with_a_shorter_one_unless_told(tmp_path, monkeypatch):
    out = tmp_path / "out"
    monkeypatch.setattr(greek_lines, "CORPUS_DIR", out)
    monkeypatch.setattr(extract, "ensure_export", lambda m: _export(tmp_path, 3))
    assert extract.main(["--work", "Euthyphro"]) == 0
    full = (out / "Euthyphro.tsv").read_text(encoding="utf-8")
    # the export comes back cut short: well formed, and two lines gone
    monkeypatch.setattr(extract, "ensure_export", lambda m: _export(tmp_path, 1))
    assert extract.main(["--work", "Euthyphro"]) == 1
    assert (out / "Euthyphro.tsv").read_text(encoding="utf-8") == full
    assert extract.main(["--work", "Euthyphro", "--allow-fewer-lines"]) == 0
    assert len((out / "Euthyphro.tsv").read_text(encoding="utf-8").split("\n")) == 3 + 1 + 1


def test_a_run_that_fails_at_one_work_writes_none(tmp_path, monkeypatch):
    out = tmp_path / "out"
    monkeypatch.setattr(greek_lines, "CORPUS_DIR", out)

    def line_file(manifest, fail="Republic"):
        if manifest.work_id == fail:
            raise RuntimeError("Diogenes export failed")
        return "# work: X\n", 1
    monkeypatch.setattr(extract, "line_file", line_file)
    with pytest.raises(RuntimeError):
        extract.main(["--all"])
    assert not out.exists() or list(out.iterdir()) == []
    # the same run with no failure does write, so the emptiness above is the refusal's doing
    monkeypatch.setattr(extract, "line_file", lambda m: line_file(m, fail=None))
    assert extract.main(["--all"]) == 0
    assert len(list(out.iterdir())) == len(WORKS)


def test_a_write_that_fails_part_way_leaves_every_old_file_as_it_was(tmp_path, monkeypatch):
    out = tmp_path / "out"
    monkeypatch.setattr(greek_lines, "CORPUS_DIR", out)
    monkeypatch.setattr(extract, "line_file", lambda m: (f"# work: {m.work_id} old\n", 1))
    assert extract.main(["--all"]) == 0
    before = {p.name: p.read_text(encoding="utf-8") for p in out.iterdir()}
    assert len(before) == len(WORKS) and "Timaeus.tsv" in before
    # every file is made and checked; then the disk refuses one of the later ones
    (out / "Timaeus.tsv.tmp").mkdir()
    monkeypatch.setattr(extract, "line_file", lambda m: (f"# work: {m.work_id} new\n", 1))
    with pytest.raises(OSError):
        extract.main(["--all", "--allow-fewer-lines"])     # the toy files are not line files to count
    (out / "Timaeus.tsv.tmp").rmdir()
    assert {p.name: p.read_text(encoding="utf-8") for p in out.iterdir()} == before


def test_a_move_that_fails_part_way_puts_back_the_files_already_moved(tmp_path, monkeypatch):
    # Codex's review: every file is staged, then the third move into place
    # fails (a locked file, say). The two moved before it must be put back.
    out = tmp_path / "out"
    monkeypatch.setattr(greek_lines, "CORPUS_DIR", out)
    monkeypatch.setattr(extract, "line_file", lambda m: (f"# work: {m.work_id} old\n", 1))
    assert extract.main(["--all"]) == 0
    (out / "Alcibiades1.tsv").unlink()                     # the first moved has no file yet
    before = {p.name: p.read_text(encoding="utf-8") for p in out.iterdir()}
    real, moves = Path.replace, []

    def replace(self, target):
        if self.suffix == ".tmp":                         # a move into place, not a put-back
            moves.append(self.name)
            if len(moves) == 3:
                raise PermissionError(1, "Operation not permitted", str(target))
        return real(self, target)
    monkeypatch.setattr(Path, "replace", replace)
    monkeypatch.setattr(extract, "line_file", lambda m: (f"# work: {m.work_id} new\n", 1))
    with pytest.raises(PermissionError):
        extract.main(["--all", "--allow-fewer-lines"])
    assert len(moves) == 3
    assert {p.name: p.read_text(encoding="utf-8") for p in out.iterdir()} == before


def test_a_write_that_fails_part_way_leaves_no_temporary_file(tmp_path, monkeypatch):
    # Codex's review: the disk fills while a file is half written.
    out = tmp_path / "out"
    monkeypatch.setattr(greek_lines, "CORPUS_DIR", out)
    real, writes = Path.write_text, []

    def write_text(self, text, *a, **k):
        writes.append(self.name)
        if len(writes) == 2:
            real(self, text[:3], *a, **k)
            raise OSError(28, "No space left on device")
        return real(self, text, *a, **k)
    monkeypatch.setattr(Path, "write_text", write_text)
    monkeypatch.setattr(extract, "line_file", lambda m: (f"# work: {m.work_id}\n", 1))
    with pytest.raises(OSError):
        extract.main(["--all"])
    assert list(out.iterdir()) == []


def test_a_put_back_that_fails_names_its_file_and_the_others_are_still_put_back(tmp_path, monkeypatch, capsys):
    # Codex's second read: a put-back that fails must not truncate its file
    # or stop the rest.
    out = tmp_path / "out"
    monkeypatch.setattr(greek_lines, "CORPUS_DIR", out)
    monkeypatch.setattr(extract, "line_file", lambda m: (f"# work: {m.work_id} old\n", 1))
    assert extract.main(["--all"]) == 0
    before = {p.name: p.read_text(encoding="utf-8") for p in out.iterdir()}
    real_replace, real_write, moves = Path.replace, Path.write_bytes, []

    def replace(self, target):
        if self.suffix == ".tmp":
            moves.append(self.name)
            if len(moves) == 3:
                raise PermissionError(1, "Operation not permitted", str(target))
        return real_replace(self, target)

    def write_bytes(self, data):
        if self.name == "Alcibiades1.tsv.back":
            real_write(self, data[:2])
            raise OSError(28, "No space left on device")
        return real_write(self, data)
    monkeypatch.setattr(Path, "replace", replace)
    monkeypatch.setattr(Path, "write_bytes", write_bytes)
    monkeypatch.setattr(extract, "line_file", lambda m: (f"# work: {m.work_id} new\n", 1))
    with pytest.raises(PermissionError):
        extract.main(["--all", "--allow-fewer-lines"])
    after = {p.name: p.read_text(encoding="utf-8") for p in out.iterdir()}
    assert "Alcibiades1.tsv" in capsys.readouterr().err
    assert after["Alcibiades1.tsv"] == "# work: Alcibiades1 new\n"      # whole, not cut short
    assert {k: v for k, v in after.items() if k != "Alcibiades1.tsv"} == {k: v for k, v in before.items() if k != "Alcibiades1.tsv"}


# ---- export-shaped text outside corpus/greek/ (decision 10, ruled A) --------
# John, 2026-11-21: keep the Euthyphro fixture, pinned. A Diogenes export is
# known by its line elements (<l n="1">…</l>), the sentence its header opens
# with (EXPORT_HEADER), or its file name (tlg0059001.xml). The one
# file allowed more than a few such lines is the fixture below, at exactly
# these bytes; any other tracked file may hold a handful (the tests' made-up
# Greek, a doc's example) and no header or export name.
import hashlib

EXPORT_LINE = re.compile(r'<l\s+n="\d+"')
# Written with \s+ so that this file does not match itself.
EXPORT_HEADER = re.compile(r"generated\s+by\s+Diogenes|from\s+the\s+TLG\s+corpus")
EXPORT_NAME = re.compile(r"(^|/)tlg\d{7}\.xml$", re.I)
FEW = 30   # under a Stephanus page; the smallest work runs to hundreds of lines
PINNED_FIXTURES = {
    "pipeline/tests/fixtures/stephanus/euthyphro_p2_3.xml": {
        "bytes": 9369, "sha256": "38226581bfbb162fc7b8e67e375d954ba708cfb58fc240bd103543c3001420eb", "lines": 77},
}


def export_problems(files: dict[str, bytes]) -> list[str]:
    problems = []
    for path, body in sorted(files.items()):
        text = body.decode("utf-8", errors="ignore")
        lines = len(EXPORT_LINE.findall(text))
        if EXPORT_NAME.search(path):
            problems.append(f"{path}: named like a Diogenes export")
        if EXPORT_HEADER.search(text):
            problems.append(f"{path}: holds a Diogenes export's header words")
        pin = PINNED_FIXTURES.get(path)
        if pin:
            got = {"bytes": len(body), "sha256": hashlib.sha256(body).hexdigest(), "lines": lines}
            if got != pin:
                problems.append(f"{path}: the pinned fixture changed: {got}, pinned {pin}")
        elif lines > FEW:
            problems.append(f"{path}: {lines} export lines, more than {FEW}; only the pinned fixture may hold more")
    for path in PINNED_FIXTURES:
        if path not in files:
            problems.append(f"{path}: the pinned fixture is gone; take it off the list")
    return problems



def _tracked() -> dict[str, bytes]:
    names = subprocess.run(["git", "ls-files", "-z"], cwd=REPO_ROOT, capture_output=True, check=True).stdout.split(b"\0")
    out = {}
    for raw in filter(None, names):
        name = raw.decode("utf-8")
        p = REPO_ROOT / name
        if p.is_file() and not p.is_symlink():
            out[name] = p.read_bytes()
    return out


_EXPORT = ('<?xml version="1.0"?>\n<TEI><text><body><div type="Stephanus-page" n="2"><div type="section" n="a">\n'
           + "".join(f'<l n="{n}">λόγος</l>\n' for n in range(1, 41)) + "</div></div></body></text></TEI>\n")
_PIN = PINNED_FIXTURES["pipeline/tests/fixtures/stephanus/euthyphro_p2_3.xml"]


@pytest.mark.parametrize("files, wanted", [
    ({"sources/x.xml": _EXPORT.encode()}, "40 export lines, more than 30"),
    ({"docs/notes.md": ("This XML text was generated " + "by Diogenes (version 4.7.2)").encode()}, "header words"),
    ({"docs/notes.md": ("from the TLG " + "corpus of classical texts").encode()}, "header words"),
    ({"sources/tlg0059001.xml": b"<TEI/>"}, "named like a Diogenes export"),
    ({"x/TLG0059036.XML": b""}, "named like a Diogenes export"),
    ({"pipeline/tests/fixtures/stephanus/euthyphro_p2_3.xml": _EXPORT.encode()}, "the pinned fixture changed"),
    ({}, "the pinned fixture is gone"),
])
def test_export_shaped_text_outside_the_pin_fails(files, wanted):
    if wanted != "the pinned fixture is gone":
        files.setdefault("pipeline/tests/fixtures/stephanus/euthyphro_p2_3.xml",
                         (REPO_ROOT / "pipeline/tests/fixtures/stephanus/euthyphro_p2_3.xml").read_bytes())
    assert any(wanted in p for p in export_problems(files)), export_problems(files)


def test_a_few_made_up_lines_pass():
    few = "".join(f'<l n="{n}">λόγος</l>' for n in range(1, FEW + 1)).encode()
    fixture = (REPO_ROOT / "pipeline/tests/fixtures/stephanus/euthyphro_p2_3.xml").read_bytes()
    assert export_problems({"pipeline/tests/x.py": few, "pipeline/tests/fixtures/stephanus/euthyphro_p2_3.xml": fixture}) == []


def test_no_tracked_file_is_export_shaped_but_the_pinned_fixture(capsys):
    files = _tracked()
    with_lines = {p: len(EXPORT_LINE.findall(b.decode("utf-8", errors="ignore"))) for p, b in files.items()}
    with_lines = {p: n for p, n in with_lines.items() if n}
    with capsys.disabled():
        print(f"\nexport-shape guard: read {len(files)} tracked files; export lines in {len(with_lines)}: "
              + ", ".join(f"{p} {n}" for p, n in sorted(with_lines.items())))
    assert len(files) > 500, len(files)          # git answered with the repo, not nothing
    assert export_problems(files) == []
