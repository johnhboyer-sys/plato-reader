"""Stage 5: LSJ entries for corpus-occurring lemmata only.

Streams grc.lsj.xml (110MB, 116,728 div2 entries) with iterparse, keeping
just the entries whose key matches a lemma in the Stage 4 analyses (exact
match first, then digit/macron-stripped base match, which also picks up all
homonyms a)1, a)2, ...). A lemma that matches no key that way falls back, in
order, to the curated alias table, the joined form of a Morpheus compound
(su/n-le/gw -> sulle/gw), LSJ's own headword and <orth> spellings, and the
dialect and spelling rules in _SPELLING_RULES (a)ne/romai -> a)nei/romai).
Entry bodies are converted from Perseus TEI to compact HTML and sharded by
initial letter.
"""

from __future__ import annotations

import json
import re
import unicodedata
from collections import defaultdict
from html import escape
from pathlib import Path

from lxml import etree

from .beta import capital_key, to_beta_key
from .config import BUILD_DIR, Manifest

# Letter-class spans keep the CSS in charge of presentation.
_TAG_MAP = {
    "head": ("b", "lsj-head"),
    "orth": ("b", "lsj-orth"),
    "gen": ("span", "lsj-gen"),
    "etym": ("span", "lsj-etym"),
    "i": ("i", None),
    "tr": ("span", "lsj-tr"),
    "foreign": ("span", "lsj-greek"),
    "quote": ("span", "lsj-quote"),
    "cit": ("span", "lsj-cit"),
    "bibl": ("span", "lsj-bibl"),
    "author": ("span", "lsj-author"),
    "title": ("i", "lsj-title"),
    "sense": ("div", "lsj-sense"),
}

_BASE_STRIP = re.compile(r"[0-9_^\-]")
_FOLD_STRIP = re.compile(r"[0-9_^\-/=\\|+]")
_CONNECTIVE = re.compile(r"^[\s,;]*(?:(?:or|and)[\s,;]*)?$", re.IGNORECASE)
_DANGLING_CONNECTIVE = re.compile(r"(?:\s*[,;]\s*)?\b(?:or|and)\s*$", re.IGNORECASE)
_DANGLING_ARTICLE = re.compile(r"\b(?:an?|the)$", re.IGNORECASE)


def base_key(key: str) -> str:
    return _BASE_STRIP.sub("", key)


def fold_key(key: str) -> str:
    """Accent/diaeresis/macron/hyphen-insensitive form; breathings kept."""
    return _FOLD_STRIP.sub("", key)


def lemma_candidates(lemma: str) -> list[tuple[str, str]]:
    """Ranked (index, value) lookups for a lemma against LSJ keys.

    Fallbacks cover Morpheus lemmatizations LSJ heads differently:
    adverbs in -ws live under the adjective (a)kribw=s -> a)kribh/s),
    verbal adjectives in -teos are headed as -teon, and synthetic
    compounds carry hyphens and extra accents (a)nti/-bla/ptw).
    """
    cands = [("exact", lemma), ("base", base_key(lemma))]
    fold = fold_key(lemma)
    cands.append(("fold", fold))
    if fold.endswith("ws"):
        cands.append(("fold", fold[:-2] + "hs"))
    if fold.endswith("teos"):
        cands.append(("fold", fold[:-4] + "teon"))
    return cands


# Spellings LSJ heads under another form, tried one at a time on the folded
# lemma once the exact, base and fold matches have failed. Most are Ionic or
# epic against Attic (a)ne/romai/a)nei/romai, paidih//paidia/, nouse/w/
# nose/w), the rest orthography (mi/gnumi/mei/gnumi, e)mpi/plhmi/
# e)mpi/mplhmi, smikro/s/mikro/s) or a headword in the other voice
# (dianoe/omai under dianoe/w). Each pattern rewrites one place in the
# lemma; the first rewrite that names an LSJ key wins.
_SPELLING_RULES: tuple[tuple[str, str], ...] = (
    (r"^([aeiouhw]+)\)", r"\1("),  # Ionic psilosis: i)/laos under i(/laos
    (r"^([aeiouhw]+)\(", r"\1)"),
    (r"(?<![aeiou])e(?![iu])", "ei"),  # a)ne/romai: a)nei/romai
    (r"(?<![aeiou])o(?![iu])", "ou"),
    (r"(?<![aeo])i", "ei"),  # mi/gnumi: mei/gnumi
    (r"ei", "i"),  # a)/meiktos: a)/miktos
    (r"ou", "o"),  # nouse/w: nose/w
    (r"ipl", "impl"),  # e)mpi/plhmi: e)mpi/mplhmi
    (r"h(s?)$", r"a\1"),  # Ionic -ίη, -ίης: paidih/, neani/hs
    (r"ous$", "oos"),  # eu)/nous: eu)/noos
    (r"eos$", "ous"),  # kera/meos: kerameou=s
    (r"^sm", "m"),  # smikromerh/s: mikromerh/s
    (r"omai$", "w"),  # dianoe/omai: dianoe/w
    (r"w$", "omai"),  # kataxra/w: kataxra/omai
    (r"amai$", "omai"),  # diape/tamai: diape/tomai
    (r"emai$", "hmi"),  # parakatati/qemai: parakatati/qhmi
)

# Prefixes that keep their final vowel before a vowel (peri/odos, pro/eimi).
_NO_ELISION = frozenset({"peri", "pro"})
_ASPIRATE = {"p": "f", "t": "q", "k": "x"}
_LABIAL = frozenset("bpfym")
_GUTTURAL = frozenset("gkxc")


def _join_prefix(prefix: str, word: str) -> str:
    """One folded preverb on a folded word, with Attic elision, aspiration
    and nasal assimilation: dia+o(rizw -> diorizw, kata+e(zomai -> kaqezomai,
    sun+legw -> sullegw, e)n+xeirew -> e)gxeirew, kata+r(izow -> katarrizow."""
    bare = re.sub(r"[()]", "", prefix)
    m = re.match(r"^([aeiouhw]+)([()])", word)
    if m:
        rough = m.group(2) == "("
        word = m.group(1) + word[m.end():]
        if prefix[-1] in "aeiou" and bare not in _NO_ELISION:
            prefix = prefix[:-1]
        elif bare == "ek":
            prefix = prefix[:-1] + "c"
        if rough and prefix[-1] in _ASPIRATE:
            prefix = prefix[:-1] + _ASPIRATE[prefix[-1]]
        return prefix + word
    if word.startswith("r("):
        return prefix + ("rr" if prefix[-1] in "aeiou" else "r") + word[2:]
    if bare in {"en", "sun"}:
        first, second = word[:1], word[1:2]
        if first in _LABIAL:
            prefix = prefix[:-1] + "m"
        elif first in _GUTTURAL:
            prefix = prefix[:-1] + "g"
        elif first in "lr":
            prefix = prefix[:-1] + first
        elif bare == "sun" and (first == "z" or (first == "s" and second not in "aeiouhw")):
            prefix = prefix[:-1]
        elif bare == "sun" and first == "s":
            prefix = prefix[:-1] + "s"
    return prefix + word


def joined_compounds(lemma: str) -> list[str]:
    """Folded one-word forms of a Morpheus compound lemma, likeliest first.

    Morpheus spells a compound verb as its preverbs, comma-separated, a hyphen
    and the simple verb (su/n-le/gw1, su/n,para/-kaqe/zomai); LSJ heads the
    word as written (sulle/gw). Sometimes the simple verb already carries the
    preverb (a)mfi/-a)mfisbhte/w, kata/-kaqe/zomai): the second form drops a
    preverb of three letters or more that the word already begins with."""
    head, sep, word = lemma.partition("-")
    if not sep or not head or not word or "-" in word:
        return []
    prefixes = [fold_key(p) for p in head.split(",")]
    if not all(prefixes):
        return []
    joined = fold_key(word)
    collapsed = joined
    for prefix in reversed(prefixes):
        joined = _join_prefix(prefix, joined)
        stem = re.sub(r"[()]", "", _join_prefix(prefix, "e("))[:-1]
        plain = re.sub(r"[()]", "", collapsed)
        bare = re.sub(r"[()]", "", prefix)
        if len(bare) >= 3 and any(
            len(s) >= 3 and plain.startswith(s[:3]) for s in (bare, stem)
        ):
            continue
        collapsed = _join_prefix(prefix, collapsed)
    return [joined] + ([collapsed] if collapsed != joined else [])


def spelling_variants(folded: str) -> list[str]:
    """Every single rewrite of a folded lemma by _SPELLING_RULES, in rule
    order and left to right within a rule."""
    out = []
    for pattern, repl in _SPELLING_RULES:
        for m in re.finditer(pattern, folded):
            variant = folded[: m.start()] + m.expand(repl) + folded[m.end():]
            if variant != folded and variant not in out:
                out.append(variant)
    return out


_KEY_RE = re.compile(r'<div2 [^>]*key="([^"]*)"')
_SPELLING_RE = re.compile(r"<(?:head|orth)\b[^>]*>([^<]+)</(?:head|orth)>")


class LsjIndex:
    """Every LSJ key, with the lookup tables the fallbacks need: by base key,
    by folded key, and by the folded spellings LSJ prints as an entry's
    headword or as an alternative <orth> inside it (mei/gnumi "or μίγνυμι";
    Λακεδαιμόνιος under Λακεδαίμων)."""

    def __init__(self) -> None:
        self.keys: set[str] = set()
        self.base: dict[str, list[str]] = defaultdict(list)
        self.fold: dict[str, list[str]] = defaultdict(list)
        self.spelling: dict[str, set[str]] = defaultdict(set)

    def add(self, key: str, spellings=()) -> None:
        self.keys.add(key)
        self.base[base_key(key)].append(key)
        self.fold[fold_key(key)].append(key)
        for text in spellings:
            word = text.strip().strip(",.;:").replace("-", "")
            try:
                beta = to_beta_key(word)
            except ValueError:
                continue
            if beta and word[:1].isupper():
                beta = capital_key(beta)
            if beta:
                self.spelling[fold_key(beta)].add(key)

    @classmethod
    def from_file(cls, path: Path) -> "LsjIndex":
        # grc.lsj.xml is not one XML document (no root element); it is a
        # stream of <div2> fragments, one entry per line, so it is scanned
        # line-wise.
        index = cls()
        with open(path, encoding="utf-8") as f:
            for line in f:
                if "<div2 " not in line:
                    continue
                m = _KEY_RE.search(line)
                if m:
                    index.add(m.group(1), _SPELLING_RE.findall(line))
        return index


_ALIAS_PATH = Path(__file__).with_name("lsj_aliases.json")


def load_lsj_aliases(path: Path = _ALIAS_PATH) -> dict[str, str]:
    """Curated Morpheus lemma -> LSJ key pairs for lemmata no rule reaches.

    lsj_aliases.json is a JSON list of {"lemma", "lsj", "justification"}
    objects, all non-empty strings, one per lemma. An alias is consulted only
    after the exact, base and fold matches fail, so it never moves a lemma
    that already has its entry."""
    entries = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(entries, list):
        raise ValueError(f"{path}: expected a JSON list")
    aliases: dict[str, str] = {}
    for entry in entries:
        if not (
            isinstance(entry, dict)
            and set(entry) == {"lemma", "lsj", "justification"}
            and all(isinstance(v, str) and v for v in entry.values())
        ):
            raise ValueError(f"{path}: invalid alias {entry!r}")
        if entry["lemma"] in aliases:
            raise ValueError(f"{path}: duplicate lemma {entry['lemma']}")
        aliases[entry["lemma"]] = entry["lsj"]
    return aliases


_SHORT_DEF_PATH = Path(__file__).with_name("lsj_short_defs.json")


def load_curated_short_defs(path: Path = _SHORT_DEF_PATH) -> dict[str, str]:
    """Curated LSJ key -> short definition, for entries whose derived
    definition and Morpheus gloss are both junk (ἰατρικός "of", ἀναπέτομαι
    "f"). lsj_short_defs.json is a JSON list of {"lsj", "short_def",
    "justification"} objects, non-empty strings, one per key; a curated
    definition replaces the derived one."""
    entries = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(entries, list):
        raise ValueError(f"{path}: expected a JSON list")
    out: dict[str, str] = {}
    for entry in entries:
        if not (
            isinstance(entry, dict)
            and set(entry) == {"lsj", "short_def", "justification"}
            and all(isinstance(v, str) and v for v in entry.values())
            and entry["lsj"] not in out
            and not junk_gloss(entry["short_def"])
        ):
            raise ValueError(f"{path}: invalid short definition {entry!r}")
        out[entry["lsj"]] = entry["short_def"]
    return out


def match_lemma(
    lemma: str, index: LsjIndex, aliases: dict[str, str]
) -> tuple[list[str], str] | None:
    """(LSJ keys, fallback) for a Morpheus lemma, or None if nothing matches.

    `fallback` is "" for the exact/base/fold matches and otherwise names the
    rule that found the keys. The fallbacks run only when those fail, in this
    order: the curated alias; a compound's joined form; LSJ's own headword
    and <orth> spellings, taken only when they name one entry (a proper name
    preferring a capitalized one); a lowercase lemma under LSJ's capitalized
    headword (e(llhni/zw: *(ellhni/zw); and the spelling rules."""
    for kind, value in lemma_candidates(lemma):
        if kind == "exact" and value in index.keys:
            return [value], ""
        if kind == "base" and index.base.get(value):
            return sorted(index.base[value]), ""
        if kind == "fold" and index.fold.get(value):
            return sorted(index.fold[value]), ""

    if lemma in aliases:
        return [aliases[lemma]], "alias"
    forms = joined_compounds(lemma)
    for form in forms:
        if index.fold.get(form):
            return sorted(index.fold[form]), "compound"
    forms = [fold_key(lemma)] + forms
    for form in forms:
        keys = index.spelling.get(form, set())
        same_case = {k for k in keys if k.startswith("*") == lemma.startswith("*")}
        keys = same_case or keys
        if len(keys) == 1:
            return sorted(keys), "lsj-spelling"
    if not lemma.startswith("*"):
        for form in forms:
            cap = capital_key(form)
            if index.fold.get(cap):
                return sorted(index.fold[cap]), "capitalized"
    for form in forms:
        for variant in spelling_variants(form):
            if index.fold.get(variant):
                return sorted(index.fold[variant]), "spelling"
    return None


def shard_letter(key: str) -> str:
    """The shard a key's entry lives in: its first a–z letter, the rule the
    readers use (preflight _lsj_shard, build-lemmata lsjShardLetter). LSJ has
    a few miskeyed entries with capitals (*Seilhniko/s), which go to e.json."""
    for ch in key:
        if "a" <= ch <= "z":
            return ch
    return "_"


def _to_html(el) -> str:
    tag = el.tag if isinstance(el.tag, str) else None
    parts = []
    if tag == "sense":
        level = el.get("level") or "1"
        n = el.get("n") or ""
        parts.append(f'<div class="lsj-sense" data-level="{escape(level)}">')
        if n:
            parts.append(f'<b class="lsj-sense-n">{escape(n)}.</b> ')
        body_open = True
    elif tag in _TAG_MAP:
        html_tag, cls = _TAG_MAP[tag]
        cls_attr = f' class="{cls}"' if cls else ""
        parts.append(f"<{html_tag}{cls_attr}>")
        body_open = True
    elif tag is None:
        body_open = False
    else:
        parts.append(f'<span class="lsj-{escape(tag)}">')
        body_open = True
    if tag is not None and el.text:
        parts.append(escape(el.text))
    for child in el:
        parts.append(_to_html(child))
    if body_open:
        if tag == "sense":
            parts.append("</div>")
        else:
            html_tag = _TAG_MAP.get(tag, ("span", None))[0]
            parts.append(f"</{html_tag}>")
    if el.tail:
        parts.append(escape(el.tail))
    return "".join(parts)


def entry_html(div2) -> str:
    parts = []
    if div2.text:
        parts.append(escape(div2.text))
    for child in div2:
        parts.append(_to_html(child))
    return "".join(parts).strip()


def _strip_edge_punctuation(value: str) -> str:
    while value and (
        value[0].isspace() or unicodedata.category(value[0]).startswith("P")
    ):
        value = value[1:]
    while value and (
        value[-1].isspace() or unicodedata.category(value[-1]).startswith("P")
    ):
        value = value[:-1]
    return value


# English words short enough to trip junk_gloss that are real glosses:
# εἰ "if", ἤ "or", μά "by", ἔρδω "do", κίω "go", ἐν "in".
_SHORT_WORDS = frozenset(
    "if or by do go in on at to up so no oh ah lo be as we us me he it hi ho i o".split()
)


def junk_gloss(gloss: str) -> bool:
    """A gloss of one or two letters that is not a whole English word: the
    stray citation letter "f" (ἀναπέτομαι, from "IG 14.1934 f"), "of" left
    from "of or for a ..." (ἰατρικός), "sṃ" (ἅτερος), "of 9 : 8"."""
    letters = "".join(ch for ch in gloss if ch.isalpha())
    if not letters or len(letters) > 2:
        return False
    return gloss.strip().strip(".,;:!").lower() not in _SHORT_WORDS


def derive_short_def(div2) -> str:
    """Derive a compact definition from an LSJ entry's leading italic run."""
    sense = next((el for el in div2.iter() if el.tag == "sense"), None)
    body = sense if sense is not None else div2
    children = list(body)
    first_i = next((i for i, child in enumerate(children) if child.tag == "i"), None)
    if first_i is None:
        return ""

    parts = ["".join(children[first_i].itertext())]
    previous = children[first_i]
    for child in children[first_i + 1 :]:
        if child.tag != "i" or not _CONNECTIVE.fullmatch(previous.tail or ""):
            break
        parts.extend((previous.tail or "", "".join(child.itertext())))
        previous = child

    short_def = " ".join("".join(parts).split())
    short_def = _strip_edge_punctuation(short_def)
    short_def = _DANGLING_CONNECTIVE.sub("", short_def)
    short_def = _strip_edge_punctuation(short_def)
    # Adjectives in -ikos/-ios are glossed "of or belonging to a <Greek noun>",
    # and the noun is untranslated Greek outside the italic run: the derivation
    # would end on a stranded article. Give up rather than ship broken English.
    if _DANGLING_ARTICLE.search(short_def):
        return ""
    # A definition this long is one continuous italic clause (technical terms
    # like kefalaiwth/s), never a joined run — cutting it would reintroduce the
    # truncation this function exists to repair, so keep the shipped gloss.
    if len(short_def) > 100:
        return ""
    if junk_gloss(short_def):
        return ""
    return short_def


def needed_lemmata(analyses: dict) -> set[str]:
    lemmata = set()
    for groups in analyses.values():
        for g in groups:
            if g["lemma"]:
                lemmata.add(g["lemma"])
    return lemmata


def run(manifest: Manifest) -> Path:
    analyses = json.loads(
        (BUILD_DIR / "stage4" / "analyses.json").read_text(encoding="utf-8")
    )
    lemmata = needed_lemmata(analyses)

    lsj_path = manifest.diogenes_data() / "grc.lsj.xml"
    index = LsjIndex.from_file(lsj_path)
    aliases = load_lsj_aliases()
    stray = sorted(k for k in aliases.values() if k not in index.keys)
    if stray:
        raise ValueError(f"{_ALIAS_PATH.name}: not LSJ keys: {stray}")

    # Match lemmata to LSJ keys by the ranked candidate list.
    lemma_map: dict[str, list[str]] = {}
    fallbacks: dict[str, str] = {}
    missing: list[str] = []
    for lemma in sorted(lemmata):
        hit = match_lemma(lemma, index, aliases)
        if hit:
            lemma_map[lemma], kind = hit
            if kind:
                fallbacks[lemma] = kind
        else:
            missing.append(lemma)
    wanted = {k for keys in lemma_map.values() for k in keys}

    # Pass 2: extract and convert just the wanted entries.
    shards: dict[str, dict] = defaultdict(dict)
    short_defs: dict[str, str] = {}
    n_kept = 0
    buf: list[str] = []
    want = False
    key = ""
    with open(lsj_path, encoding="utf-8") as f:
        for line in f:
            if "<div2 " in line:
                m = _KEY_RE.search(line)
                key = m.group(1) if m else ""
                want = key in wanted
                buf = []
            if want:
                buf.append(line)
                if "</div2>" in line:
                    fragment = "".join(buf)
                    start = fragment.index("<div2 ")
                    end = fragment.rindex("</div2>") + len("</div2>")
                    div2 = etree.fromstring(fragment[start:end])
                    head = div2.findtext("head") or key
                    shards[shard_letter(key)][key] = {
                        "key": key,
                        "head": head,
                        "html": entry_html(div2),
                    }
                    short_def = derive_short_def(div2)
                    if short_def:
                        short_defs[key] = short_def
                    n_kept += 1
                    want = False

    curated = load_curated_short_defs()
    stray = sorted(k for k in curated if k not in index.keys)
    if stray:
        raise ValueError(f"{_SHORT_DEF_PATH.name}: not LSJ keys: {stray}")
    short_defs.update({k: v for k, v in curated.items() if k in wanted})

    out_dir = BUILD_DIR / "stage5"
    (out_dir / "lsj").mkdir(parents=True, exist_ok=True)
    for letter, entries in sorted(shards.items()):
        (out_dir / "lsj" / f"{letter}.json").write_text(
            json.dumps(entries, ensure_ascii=False), encoding="utf-8"
        )
    (out_dir / "lemma_map.json").write_text(
        json.dumps(lemma_map, ensure_ascii=False), encoding="utf-8"
    )
    (out_dir / "short_defs.json").write_text(
        json.dumps(short_defs, ensure_ascii=False), encoding="utf-8"
    )
    (out_dir / "fallback_matches.json").write_text(
        json.dumps(
            {k: [fallbacks[k], lemma_map[k]] for k in sorted(fallbacks)},
            ensure_ascii=False, indent=1,
        ),
        encoding="utf-8",
    )
    (out_dir / "missing_lemmata.json").write_text(
        json.dumps(missing, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    summary = {
        "lemmata_needed": len(lemmata),
        "lsj_entries_kept": n_kept,
        "short_defs": len(short_defs),
        "shards": len(shards),
        "lemmata_without_entry": len(missing),
        "lemmata_by_fallback": len(fallbacks),
    }
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=1))
    return out_dir
