"""Stage 1 English walker for Perseus' Stephanus-milestoned Plato TEI.

The Greek spine owns the section inventory and all speaker rendering.  This
module only groups the English prose at the TEI's ``section`` milestones, using
the same ``{book}:{page}{letter}`` identifiers as that spine.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path

from lxml import etree

from .config import BUILD_DIR, SOURCES_DIR, Manifest
from .stage1_common import collapse_ws, local_name, write_json


_SECTION = re.compile(r"^\d+[a-e]$")
_PREFIX = re.compile(r"^(\d+)([a-e])")
_LOG = logging.getLogger(__name__)


def _prefix(token: str) -> tuple[int, str] | None:
    """(page, letter) of a token, ignoring any trailing line; None if unparsable."""
    m = _PREFIX.match(token or "")
    return (int(m.group(1)), m.group(2)) if m else None


class _Walker:
    def __init__(self, books: list[dict] | None = None):
        books = books or [{"n": 1}]
        # A multi-book work (Republic, Laws) nests its sections under ordered
        # <div subtype="book"> divisions; a bookless work (Letters, and every
        # single-dialogue work) may still carry structural <div subtype="letter">
        # / "book" divisions we IGNORE, folding all sections into book 1 so a
        # section straddling a division boundary (Letters splits some Stephanus
        # pages across two letters, repeating the section token) merges into one
        # chunk keyed (1, token).
        self.multibook = len(books) > 1
        self._starts = [b.get("start") for b in books]
        self._book_divs = 0  # count of book/letter divs entered (order key)
        self._verify_start: str | None = None  # first-section check pending
        self.book = 1
        self.section: str | None = None
        self.chunks: list[dict] = []
        self.by_key: dict[tuple[int, str], dict] = {}

    def _chunk(self) -> dict | None:
        if self.section is None:
            return None
        key = (self.book, self.section)
        if key not in self.by_key:
            self.by_key[key] = {
                "id": f"{self.book}:{self.section}",
                "book": self.book,
                "column": self.section,
                "text": "",
                "notes": [],
                "markers": [],
                "bekker": [],
            }
            self.chunks.append(self.by_key[key])
        return self.by_key[key]

    def add_text(self, text: str | None) -> None:
        if text and (chunk := self._chunk()) is not None:
            chunk["text"] += text

    def _check_book_start(self, token: str) -> None:
        """Warn if a book division's first section token disagrees with the
        manifest's declared start for that book (compared at page+letter)."""
        expected = self._verify_start
        if not expected:
            return
        if _prefix(token) != _prefix(expected):
            _LOG.warning(
                "book %d: first section %r != manifest start %r",
                self.book, token, expected,
            )

    def add_note(self, el) -> None:
        chunk = self._chunk()
        if chunk is None:
            return
        text = collapse_ws("".join(el.itertext())).strip()
        if text:
            chunk["notes"].append({"column": self.section, "text": text})

    def walk(self, el) -> None:
        tag = local_name(el)
        if tag is None:
            self.add_text(el.tail)
            return
        if tag == "milestone":
            if el.get("unit") == "section":
                token = el.get("n", "")
                if _SECTION.fullmatch(token):
                    # A milestone's following tail is the start of its section.
                    self.section = token
                    if self._verify_start is not None:
                        self._check_book_start(token)
                        self._verify_start = None
                else:
                    _LOG.warning("skipping non-Stephanus section milestone n=%r", token)
            self.add_text(el.tail)
            return
        if tag == "note":
            self.add_note(el)
            self.add_text(el.tail)
            return

        # TEI paragraph siblings need a prose separator even when their source
        # indentation has been stripped (a milestone can sit between them).
        if tag == "p" and (chunk := self._chunk()) is not None and chunk["text"]:
            self.add_text(" ")

        previous_book = self.book
        subtype = el.get("subtype") if tag == "div" else None
        if self.multibook and subtype in {"book", "letter"}:
            # Map divisions to book numbers by ORDER (1st div = book 1), not by
            # the div's @n — the order is authoritative and @n can be absent or
            # non-numeric. Verify the division's first section token against the
            # manifest book start at the next section milestone.
            self._book_divs += 1
            self.book = self._book_divs
            self._verify_start = self._starts[self.book - 1] \
                if self.book - 1 < len(self._starts) else None

        self.add_text(el.text)
        for child in el:
            self.walk(child)
        self.add_text(el.tail)
        self.book = previous_book


def parse_english(xml_path: Path, manifest: Manifest) -> dict:
    """Parse a Perseus English TEI into Stephanus-keyed chunk records."""
    tree = etree.parse(str(xml_path))
    body = tree.find(".//{*}body")
    if body is None:
        raise ValueError(f"no TEI body found in {xml_path}")
    walker = _Walker(manifest.data.get("books"))
    walker.walk(body)
    for chunk in walker.chunks:
        chunk["text"] = collapse_ws(chunk["text"]).strip()
    chunks = [c for c in walker.chunks if c["text"] or c["notes"]]
    primary = (manifest.data.get("english") or {}).get("primary") or {}
    return {
        "work": manifest.work_id,
        "source": xml_path.name,
        "translation": primary.get("name", primary.get("id", "Perseus")),
        "chunks": chunks,
    }


def build_alignment(spine: dict, english: dict) -> dict:
    eng_ids = {chunk["id"] for chunk in english["chunks"]}
    spine_ids = {segment["id"] for segment in spine["segments"]}
    return {
        "work": spine["work"],
        "pairs": [
            {"segment": segment["id"],
             "english": segment["id"] if segment["id"] in eng_ids else None}
            for segment in spine["segments"]
        ],
        "english_only": sorted(eng_ids - spine_ids),
    }


def _tei_path(manifest: Manifest) -> Path:
    primary = ((manifest.data.get("english") or {}).get("primary") or {})
    name = primary.get("file")
    if not name:
        work = manifest.data["work"]["tlg_work"]
        author = manifest.data["work"].get("tlg_author", "0059")
        name = f"perseus-eng/tlg{author}.tlg{work}.perseus-eng2.xml"
    return SOURCES_DIR / name


def run(manifest: Manifest, spine: dict) -> tuple[Path, Path]:
    english = parse_english(_tei_path(manifest), manifest)
    out_dir = BUILD_DIR / "stage1"
    out_dir.mkdir(parents=True, exist_ok=True)
    eng_path = out_dir / "english_chunks.json"
    write_json(eng_path, english)
    align_path = out_dir / "alignment.json"
    write_json(align_path, build_alignment(spine, english))
    return eng_path, align_path
