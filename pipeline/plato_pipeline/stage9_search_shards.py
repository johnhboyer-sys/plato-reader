"""Stage 9: one search index for the whole corpus, sharded by a word's first
two letters.

A search over every work used to fetch every work's index: 36 works, two or
three files each, before a single result could be shown. On a phone that is
seconds of waiting, and a burst that size is what makes Safari drop requests.
A word's postings in every work now sit in one shard, so a query fetches only
the shards its words can fall in: "justice" is one shard.

A corpus-wide stage, like stage 8: it reads the per-work indexes stage 7 left
in build/dist and writes

  build/dist/search-shards/index.json
      {"streams": {stream: {"shards": [name, ...],
                            "sources": {source: sha256-prefix, ...}}}}

  build/dist/search-shards/<stream>/<shard>.json
      {word: {source: postings}}

  build/dist/search-shards/vocab.json
      {"forms": [form, ...]}: every word of the form stream, sorted

  build/dist/search-shards/accents/<shard>.json
      {form: [spelling, ...]}: a form's accented spellings as the books'
      Greek tokens print them (see display_spelling and rank_spellings),
      filed in the same shards as the form stream

Streams and the per-work files they copy:
  lemma    search/greek_lemma.json, source = the work id
  form     search/greek_form.json,  source = the work id
  english  search/english.json and search/english-<slot>.json,
           source = "<work>/english" for the primary, "<work>/<slot>" beyond it
           (Jowett is "<work>/overlay-jowett")

Postings are copied unchanged, so a seg_idx still counts positions in that
work's meta.json and the reader's matching code runs on them as it always
has. A source's hash is of the per-work file it was copied from: the deploy
check recomputes it to refuse shards older than the indexes beside them.
The per-work files stay: combo and grammatical search still read them, and the
reader falls back to them for a source the shards do not list.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

from .config import BUILD_DIR
from .stage6_search import fold_lemma

SHARD_DIR = "search-shards"
GREEK_FILES = {"lemma": "greek_lemma.json", "form": "greek_form.json"}
STREAMS = (*GREEK_FILES, "english")


def shard_name(word: str) -> str:
    """The shard a word is filed under: its first two characters, each a-z
    kept and anything else (an apostrophe, or no character at all in a
    one-letter word) written as '_'. Mirrored by shardName() in
    shared/lib/search.ts and pinned by tests/fixtures/search_shards.json."""
    return "".join(c if "a" <= c <= "z" else "_" for c in (word + "__")[:2])


def index_sources(work_dir: Path) -> list[tuple[str, str, Path]]:
    """(stream, source, path) for every per-work index a work carries. The
    Greek indexes and the primary English one are always emitted, so their
    absence is an error the caller reports; the translations beyond the
    primary are whatever english-<slot>.json files stage 7 wrote."""
    search = work_dir / "search"
    work = work_dir.name
    out = [(stream, work, search / name) for stream, name in GREEK_FILES.items()]
    out.append(("english", f"{work}/english", search / "english.json"))
    for path in sorted(search.glob("english-*.json")):
        out.append(("english", f"{work}/{path.stem[len('english-'):]}", path))
    return out


_ACUTE, _GRAVE, _CIRCUMFLEX = "\u0301", "\u0300", "\u0342"


def display_spelling(surface: str) -> str:
    """A Greek token as the word it spells, NFC: a grave becomes the acute
    it stands for (πρὸς is πρός), and of two accent marks the later goes (an
    enclitic's acute: ἄνθρωπός is ἄνθρωπος). Breathings, iota subscripts,
    diaeresis, elision apostrophes and case are kept as written."""
    out, accented = [], False
    for c in unicodedata.normalize("NFD", surface):
        if c == _GRAVE:
            c = _ACUTE
        if c in (_ACUTE, _CIRCUMFLEX):
            if accented:
                continue
            accented = True
        out.append(c)
    return unicodedata.normalize("NFC", "".join(out))


def rank_spellings(counts: dict[str, int]) -> list[str]:
    """One form's spellings, from display_spelling -> token count, commonest
    first. Spellings that differ only in case are one spelling, counted
    together and shown in their commonest case (ὅτι, not a sentence-initial
    Ὅτι; Σωκράτης keeps its capital), lower case on a tie. Tied spellings go
    in alphabetical order."""
    groups: dict[str, list[tuple[int, str]]] = defaultdict(list)
    for spelling, n in counts.items():
        groups[spelling.lower()].append((n, spelling))
    ranked = []
    for lower, variants in groups.items():
        shown = min(variants, key=lambda v: (-v[0], v[1] != lower, v[1]))[1]
        ranked.append((-sum(n for n, _ in variants), shown))
    return [shown for _, shown in sorted(ranked)]


def source_hash(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()[:16]


def run(dist: Path | None = None) -> Path:
    dist = dist or BUILD_DIR / "dist"
    works = sorted(p.parent.parent for p in dist.glob("*/search/meta.json"))
    if not works:
        raise ValueError(f"stage9: no work in {dist} has a search index — run stage7 first")

    # Each word's postings are kept as the compact JSON text they will be
    # written as, not as lists of pairs: the corpus holds millions of postings,
    # and as Python lists they would cost gigabytes.
    shards: dict[str, dict[str, dict[str, dict[str, str]]]] = {
        stream: defaultdict(dict) for stream in STREAMS
    }
    sources: dict[str, dict[str, str]] = {stream: {} for stream in STREAMS}
    postings = {stream: 0 for stream in STREAMS}
    for work_dir in works:
        for stream, source, path in index_sources(work_dir):
            if not path.exists():
                raise ValueError(f"stage9: {work_dir.name} has no search/{path.name}")
            raw = path.read_bytes()
            sources[stream][source] = source_hash(raw)
            for word, plist in json.loads(raw).items():
                shards[stream][shard_name(word)].setdefault(word, {})[source] = (
                    json.dumps(plist, separators=(",", ":"))
                )
                postings[stream] += len(plist)

    # The spellings of each form, from the books' Greek tokens, keyed by the
    # fold stage6 indexed each token under.
    spellings: dict[str, Counter] = defaultdict(Counter)
    for work_dir in works:
        for book in sorted(work_dir.glob("book-*.json")):
            for seg in json.loads(book.read_text(encoding="utf-8"))["segments"]:
                for line in seg.get("greek", []):
                    for tok in line["tokens"]:
                        form = fold_lemma(tok["k"]) if tok.get("k") else ""
                        if form:
                            spellings[form][display_spelling(tok["t"])] += 1

    out = dist / SHARD_DIR
    if out.exists():
        shutil.rmtree(out)
    index: dict[str, dict] = {"streams": {}}
    for stream in STREAMS:
        (out / stream).mkdir(parents=True)
        for name, words in shards[stream].items():
            body = ",".join(
                json.dumps(word, ensure_ascii=False) + ":{"
                + ",".join(f"{json.dumps(src)}:{text}" for src, text in by_source.items())
                + "}"
                for word, by_source in sorted(words.items())
            )
            (out / stream / f"{name}.json").write_text("{" + body + "}", encoding="utf-8")
        index["streams"][stream] = {
            "shards": sorted(shards[stream]),
            "sources": sources[stream],
        }
    # Every key a pattern with no literal prefix is matched against, per stream.
    forms = sorted(w for words in shards["form"].values() for w in words)
    lemmas = sorted(w for words in shards["lemma"].values() for w in words)
    (out / "vocab.json").write_text(
        json.dumps({"forms": forms, "lemmas": lemmas}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (out / "accents").mkdir()
    for name, words in shards["form"].items():
        accents = {}
        for form in sorted(words):
            if not spellings.get(form):
                raise ValueError(f"stage9: no Greek token in the books spells the form {form!r}")
            accents[form] = rank_spellings(spellings[form])
        (out / "accents" / f"{name}.json").write_text(
            json.dumps(accents, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (out / "index.json").write_text(json.dumps(index, indent=1), encoding="utf-8")
    summary = {
        "works": len(works),
        "streams": {
            stream: {
                "sources": len(sources[stream]),
                "shards": len(shards[stream]),
                "words": sum(len(w) for w in shards[stream].values()),
                "postings": postings[stream],
            }
            for stream in STREAMS
        },
    }
    (out / "summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    return out
