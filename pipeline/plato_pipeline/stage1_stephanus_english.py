"""Stage 1 English walker for Perseus' Stephanus-milestoned Plato TEI.

The Greek spine owns the section inventory. This module groups the English
prose at the TEI's ``section`` milestones, using the same ``{book}:{page}{letter}``
identifiers as that spine, AND lifts the dialogue's speaker turns out of the
prose so the reader can pair each speaker's Greek with the same speaker's
English.

Turn model (paired against the Greek spine in stage 7 via ``turns.py``)
----------
Every English TEI marks a speech as ``<said who="#Name">`` and (at print-worthy
turns) carries a ``<label>`` child with the lead-in as printed ("Socrates.",
"Soc.", "EU."). We STRIP the label from the prose — exactly as the Greek spine
strips its inline sigla — and record, per chunk, ``turns: [{offset, speaker,
display}]`` where ``offset`` is the char position in the flattened prose at which
the turn's TEXT begins, ``speaker`` is the canonical name (@who, alias-normalized,
``who="-"``/unattributed → null), and ``display`` is the printed label (null when
the said carries none, e.g. the bare reported-speech turns that mirror the
Greek's "—" dashes).

Nested ``<said>`` (reported speech quoted inside a narrated frame, e.g.
Protagoras/Euthydemus) are emitted as turns only when the manifest asks for it
(``speakers.nested: inner``). The GREEK is the arbiter of the pairing level:
where the OCT marks the inner reported turns with bare dashes the work reconciles
at inner level, so ``inner`` lets those turns pair (via the null-wildcard rule in
stage7); where it does not (Phaedo's recounting carries no Greek events at all),
the default ``frame`` level keeps only the top-level turns and the recounted
dialogue stays section-aligned prose. Per-segment pairing is self-correcting
either way — a count/name mismatch simply emits no pairs — so the flag only tunes
how much of a narrated work pairs, never whether a pairing is correct.
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

# Sentinel marking a turn's text-start in the accumulated prose. It carries no
# whitespace, so `collapse_ws` never merges it away; a post-collapse scan turns
# each occurrence into a `turns` offset and removes it (mirrors the Greek spine's
# `_line_with_speakers`). U+0000 never occurs in Perseus TEI text.
_TURN_SENTINEL = "\x00"

# Sentinel marking a TEI paragraph boundary (`<p>` open) in the accumulated
# prose. Like the turn sentinel it survives `collapse_ws`; a post-collapse scan
# turns each occurrence into a `paragraph` marker offset and removes it. U+0001
# is illegal in XML 1.0 text, so it can never occur inside parsed TEI content
# (asserted belt-and-braces in `add_text`).
_PARA_SENTINEL = "\x01"


def _canonical_who(who: str | None, aliases: dict[str, str]) -> str | None:
    """Canonical speaker name from a `<said @who>` value.

    Strips the leading '#', applies per-token @who aliases (Cephalos→Cephalus,
    Ἀθηναῖος→Athenian), and maps the unattributed dialectic marker (``who="-"``
    or empty) to None so it pairs with the Greek's bare "—" dash. A joint
    attribution ("#Dionysodorus #Euthydemus") stays a single space-joined name;
    it only ever occurs inside dash regions where the Greek side is null, so the
    exact string never gates a pairing."""
    if not who:
        return None
    toks = [aliases.get(t.lstrip("#"), t.lstrip("#")) for t in who.split()]
    canon = " ".join(t for t in toks if t and t != "-")
    return canon or None


def _prefix(token: str) -> tuple[int, str] | None:
    """(page, letter) of a token, ignoring any trailing line; None if unparsable."""
    m = _PREFIX.match(token or "")
    return (int(m.group(1)), m.group(2)) if m else None


def resolve_sentinels(text: str) -> tuple[str, list[int], list[int]]:
    """Split a collapsed chunk text on turn and paragraph sentinels in one scan.

    Returns (clean_text, turn_offsets, para_offsets) where clean_text has both
    sentinel chars removed and a single space normalises each boundary, and each
    offset is the char position in clean_text where the marked text begins. A
    sentinel at the very start yields offset 0 (no leading space); elsewhere a
    separating space precedes the offset so consecutive spans read as prose. A
    paragraph sentinel adjacent to a turn sentinel yields equal offsets (fine —
    the two mark the same boundary). Mirrors the Greek spine's marker resolution
    so both columns place turns identically."""
    out: list[str] = []
    n = 0  # == len("".join(out)); tracked to avoid a rescan per sentinel
    turn_offsets: list[int] = []
    para_offsets: list[int] = []
    i = 0
    length = len(text)
    while i < length:
        ch = text[i]
        if ch == _TURN_SENTINEL or ch == _PARA_SENTINEL:
            i += 1
            if i < length and text[i] == " ":
                i += 1  # absorb a single space after the stripped label/break
            if out and out[-1] != " ":
                out.append(" ")
                n += 1
            (turn_offsets if ch == _TURN_SENTINEL else para_offsets).append(n)
        else:
            out.append(ch)
            n += 1
            i += 1
    return "".join(out), turn_offsets, para_offsets


class _Walker:
    def __init__(
        self,
        books: list[dict] | None = None,
        who_aliases: dict[str, str] | None = None,
        nested: str = "frame",
    ):
        self.who_aliases = who_aliases or {}
        # "frame" (default): emit a turn only for a top-level said, so reported
        # speech quoted inside a narrated frame stays prose. "inner": emit a turn
        # for every said, letting the Greek's dash-marked inner turns pair.
        self.nested = nested
        # Stack of the open said elements, each paired with the turn mark it
        # emitted (or None when this said level emits no turn) so a <label> child
        # can attach its printed text to the right pending turn.
        self._said_stack: list[dict | None] = []
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
                # Speaker turns starting in this chunk, in document order; each
                # {speaker, display} is paired with a sentinel spliced into
                # `text` and resolved to an `offset` once the chunk is collapsed.
                "turns": [],
            }
            self.chunks.append(self.by_key[key])
        return self.by_key[key]

    def add_text(self, text: str | None) -> None:
        if text and (chunk := self._chunk()) is not None:
            # Belt-and-braces: the control-char sentinels are XML-illegal, so
            # parsed TEI text can never carry them; assert rather than let a
            # stray one masquerade as a turn/paragraph boundary downstream.
            assert _TURN_SENTINEL not in text and _PARA_SENTINEL not in text, \
                "control-char sentinel present in parsed TEI text"
            chunk["text"] += text

    def open_turn(self, speaker: str | None) -> dict:
        """Splice a turn sentinel into the current chunk and register its mark.

        The sentinel sits at the said's start; its `display` is filled in later
        if the said carries a <label> child (whose text is dropped from the
        prose). Returns the mark so the caller can push it on the said stack."""
        mark = {"speaker": speaker, "display": None}
        chunk = self._chunk()
        if chunk is not None:
            chunk["text"] += _TURN_SENTINEL
            chunk["turns"].append(mark)
        return mark

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
        if tag == "said":
            # A turn boundary. Emit it at the top level always, and at a nested
            # level only under the `inner` policy; either way descend so the
            # speech text flows into the prose. The mark (or None) rides the said
            # stack so a <label> child attaches its printed lead-in.
            emit = self.nested == "inner" or not self._said_stack
            speaker = _canonical_who(el.get("who"), self.who_aliases)
            mark = self.open_turn(speaker) if emit else None
            self._said_stack.append(mark)
            self.add_text(el.text)
            for child in el:
                self.walk(child)
            self.add_text(el.tail)
            self._said_stack.pop()
            return
        if tag == "label":
            # A speaker lead-in (direct child of an emitted said) is captured as
            # that turn's `display` and DROPPED from the prose, mirroring the
            # Greek spine's inline-siglum stripping. Any other <label> (a section
            # heading standing outside a turn) is ordinary prose, kept verbatim.
            top = self._said_stack[-1] if self._said_stack else None
            if top is not None and top["display"] is None:
                top["display"] = collapse_ws("".join(el.itertext())).strip() or None
                self.add_text(el.tail)
                return
            self.add_text(el.text)
            for child in el:
                self.walk(child)
            self.add_text(el.tail)
            return

        # TEI paragraph siblings need a prose separator even when their source
        # indentation has been stripped (a milestone can sit between them). The
        # paragraph sentinel both separates the prose (resolving to a single
        # space) AND records a `paragraph` marker offset. It rides whichever
        # chunk is current at `<p>` open — a section milestone can sit inside a
        # `<p>` (Republic constantly), which is correct: the break belongs to
        # the section it opens in.
        if tag == "p" and (chunk := self._chunk()) is not None and chunk["text"]:
            chunk["text"] += _PARA_SENTINEL

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


def finalize_chunk(chunk: dict) -> None:
    """Collapse a chunk's accumulated prose and resolve its sentinels, in place.

    Turn sentinels become `turns: [{offset, speaker, display}]`; paragraph
    sentinels become `markers: [{kind:"paragraph", n:"", offset}]`. Leading/
    trailing whitespace is trimmed and every offset is shifted to match the
    trimmed text. Paragraph offsets landing at the chunk edges (0 or the trimmed
    length) are dropped — a paragraph break at the chunk start carries no
    information — and consecutive equal offsets are deduped."""
    clean, offsets, para_offsets = resolve_sentinels(collapse_ws(chunk["text"]))
    lstripped = clean.lstrip()
    shift = len(clean) - len(lstripped)
    clean = lstripped.rstrip()
    marks = chunk.get("turns", [])
    chunk["text"] = clean
    chunk["turns"] = [
        {"offset": max(0, min(off - shift, len(clean))),
         "speaker": m["speaker"], "display": m["display"]}
        for off, m in zip(offsets, marks)
    ]
    para_markers: list[dict] = []
    for off in para_offsets:
        shifted = off - shift
        if 0 < shifted < len(clean) and (
            not para_markers or para_markers[-1]["offset"] != shifted
        ):
            para_markers.append({"kind": "paragraph", "n": "", "offset": shifted})
    chunk["markers"] = para_markers


def speaker_config(manifest: Manifest) -> tuple[dict[str, str], str]:
    """(@who aliases, nested-said policy) declared under the manifest's
    `speakers:` block. The block maps sigla → names on the Greek side and, where
    the English @who spelling drifts, `who_aliases`; `nested` selects frame vs
    inner reported-speech turns (default frame)."""
    spk = manifest.data.get("speakers") or {}
    if not isinstance(spk, dict):
        return {}, "frame"
    aliases = spk.get("who_aliases") or {}
    nested = spk.get("nested") or "frame"
    return aliases, nested


def parse_english(xml_path: Path, manifest: Manifest) -> dict:
    """Parse a Perseus English TEI into Stephanus-keyed chunk records."""
    tree = etree.parse(str(xml_path))
    body = tree.find(".//{*}body")
    if body is None:
        raise ValueError(f"no TEI body found in {xml_path}")
    aliases, nested = speaker_config(manifest)
    walker = _Walker(manifest.data.get("books"), who_aliases=aliases, nested=nested)
    walker.walk(body)
    for chunk in walker.chunks:
        finalize_chunk(chunk)
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
