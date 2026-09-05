"""Match a narrated section's Greek paragraph marks to English cut points.

Burnet paragraphs the Republic one turn at a time; Shorey does not — he runs a
whole exchange into one paragraph and marks each speech with quotation marks
instead. `turns.build_para_flow`'s spine mode makes Burnet's marks the row
spine, which needs, per Stephanus section, the point in Shorey's prose that
each Greek mark corresponds to.

This module is that matcher, and nothing else: plain data in, index pairs out.
It knows no TEI, no manifest, no turn model.

    candidates_for_chunk(text, markers) -> [Candidate]   # where English MAY cut
    with_carry(prev, ..., text, ...) -> (text, carry, [Candidate])
    match_section(greek, english, ...) -> [int | None]   # one per Greek mark

`match_section` is a monotone Needleman-Wunsch (the house shape — see
`align_turns.align`) over the two sequences. Gapping a Greek mark costs; passing
over an English candidate is free, because the English carries cut points the
Greek has no paragraph for (a section boundary falling mid-turn, a sentence
Shorey broke that Burnet did not). A gapped mark merges into the previous row
upstream, so an unmatched mark never yields a Greek-only row.

The signals scoring a pair, summed:

1.  A gloss bridge. The Greek paragraph's tokens carry Perseus short-definition
    glosses; their words, plus a small proper-name table (the glosses for names
    are blank), are scored by TF-IDF cosine against the English text at the
    candidate. The English window is length-normalised — as long a share of the
    section's English as the Greek paragraph is of the section's Greek — so the
    comparison does not depend on which candidate the DP picks next.
2.  A cue table over the attribution formulae: ἦν δʼ ἐγώ ↔ "said I", ἔφη / ἦ δʼ
    ὅς ↔ "he said", ἔφη ὁ Πολέμαρχος ↔ "said Polemarchus", and the stock short
    replies (ναί ↔ Yes, πάνυ γε ↔ Certainly). Agreement pays, contradiction
    costs — first-person Greek against third-person English is a whole turn's
    drift, which is the error mode a purely positional match makes.
3.  A weak position prior with a tolerance band. Perseus' English section
    milestones sit where Shorey's page broke, not where Burnet's did, so a
    section's two sides routinely run a tenth of a section out of step; only
    gross disagreement is penalised. That same drift is why the section's own
    chunk is not always enough English to cut on — see `with_carry`.
4.  Paragraph-length agreement, weakly, and question-mark counts. Length is
    what separates 413b's `Τραγικῶς, ἦν δʼ ἐγώ …` — 188 characters of Greek
    against 241 of English — from the two-clause turn two paragraphs before it
    that sits at the same position in the section.

Weights were fitted against a hand-checked gold set of 44 marks over ten
sections (`tests/test_para_align.py`), on a broad plateau rather than a knife
edge: everything from GAP -0.25 to -0.45 and POS_BAND 0.12 to 0.30 gives the
same gold answers.
"""

from __future__ import annotations

import math
import re
import unicodedata
from dataclasses import dataclass, field

from .align import similarity


# ── data ─────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Candidate:
    """A point in one section's English prose where a row may start."""
    offset: int
    kind: str    # "start" | "speech" | "paragraph" | "sentence"
    cue: str     # the prose from `offset` onward, head only, for cue matching


@dataclass(frozen=True)
class MarkFeat:
    """One Greek paragraph mark and the paragraph it opens."""
    offset: int                            # char offset in the section's Greek
    text: str                              # the paragraph (mark → next/end)
    glosses: tuple[str, ...] = field(default_factory=tuple)


# ── English candidates ───────────────────────────────────────────────────────

# Verbs of saying. A run of speech that resumes after one of these is the SAME
# turn interrupted by its attribution ("Why, is there not left," said I, "the
# alternative…"), not a new one.
_INQUIT = (
    "said", "says", "replied", "answered", "asked", "rejoined", "interposed",
    "exclaimed", "continued", "resumed", "went on", "cried", "added",
    "observed", "remarked", "retorted", "returned", "repeated", "put in",
    "inquired", "enquired", "declared", "urged", "assented", "agreed",
    "objected", "laughed", "protested", "insisted", "murmured",
)
_INQUIT_RE = re.compile(r"\b(?:%s)\b" % "|".join(w.replace(" ", r"\s+")
                                                for w in _INQUIT), re.I)

# Shorey's sentence ends: a stop, optionally closed by a curly apostrophe or
# quote, then space. A semicolon or colon is NOT one — he uses both inside a
# single utterance ("There is nothing to prevent, said I; yet even granted…").
_SENT_END = re.compile(r"[.?!][’”\"']?[\s—–]+")

# An attribution can only be this long, and a lead-in only this long, before it
# stops being an interruption and starts being prose in its own right.
_MAX_ATTRIB = 60
_MAX_LEADIN = 80
_ATTRIB_TAIL = (",", ";", ":", "—", "–", "-")

# How much of a candidate's opening carries its own attribution. Keep it short:
# a longer head reaches into the NEXT turn, and "Humph! said he, how very like
# the two cases are! There is nothing to prevent, said I" then reads as a
# first-person turn when it is a third-person one.
_CUE_HEAD = 60

# How long a spoken run may be and still speak for its whole length. A short
# quotation is one utterance and Burnet never paragraphs inside it, so a
# sentence start in there is Shorey's punctuation, not a turn — drop it. A long
# one is a set speech (Thrasymachus' harangue, Glaucon's, Er's myth), and Burnet
# DOES break those, at sentence starts and nowhere else; suppress there and the
# only cut points the section has go with them. So the markup's "the turn
# continues" is trusted over a short run and disregarded over a long one.
#
# A run that touches its chunk's start or end is a fragment: the walker closes
# and reopens speech at every Stephanus milestone, so a speech crossing one
# arrives as two runs, neither of them its own length. Its length is unknown,
# so it suppresses nothing — which is what recovers the long speeches, since a
# speech long enough for Burnet to break inside is long enough to cross a
# milestone. Republic runs that DON'T touch an edge top out at 559 characters.
#
# Swept 0–500 against the build (matched marks / lowercase-opening rows / gold):
# 0–40 → 4156/28/pass, 60–77 → 4156/26/pass, 78–100 → 4155/26/FAIL, 150 →
# 4152/25/FAIL, ≥200 → 4151/24/FAIL. 60–77 is the plateau: flat, gold-clean, and
# two fewer mid-sentence row openings than the shorter end. The cliff at 78 is
# 337c, where "Is that, then, said he, what you are going to do? Are you going
# to give one of the forbidden answers?" is one turn in a 77-character run —
# suppressing its second sentence is right, but the weights then can't reach the
# turn's real opening either and the mark goes unmatched (KNOWN_MISS 337c/2).
SPEECH_SUPPRESS_MAX = 70


def _has_inquit(s: str) -> bool:
    return bool(_INQUIT_RE.search(s))


def _sentence_start(text: str, offset: int) -> int:
    """Start of the sentence containing `offset`."""
    last = 0
    for m in _SENT_END.finditer(text, 0, offset):
        last = m.end()
    return last


def _pair_runs(speech: list[int], speech_end: list[int],
               text_len: int) -> list[tuple[int, int]]:
    """Pair each `speech` offset with the next `speech-end` in document order.

    `speech` and `speech_end` are each already sorted, but a section that
    straddled a chunk boundary before the walker's straddle fix (or any
    future producer that doesn't perfectly interleave the two) can hand this
    an unequal or misordered pair of lists -- a positional `zip` then pairs
    the wrong start with the wrong end. Walking the two lists in lockstep
    instead pairs each start with the nearest end that follows it: a leading
    `speech-end` with no `speech` before it is dropped (it belongs to a
    quotation that opened before this chunk), and a trailing `speech` with no
    `speech-end` after it closes at the end of the text (it stays open past
    this chunk)."""
    runs: list[tuple[int, int]] = []
    ends = iter(speech_end)
    end = next(ends, None)
    for s in speech:
        while end is not None and end <= s:
            end = next(ends, None)     # a leading/stale speech-end: drop it
        if end is not None:
            runs.append((s, end))
            end = next(ends, None)
        else:
            runs.append((s, text_len))  # trailing unpaired speech
    return runs


def candidates_for_chunk(text: str, markers: list[dict]) -> list[Candidate]:
    """Points in one section's English where a Greek paragraph may be matched.

    A candidate is the start of a top-level spoken run that is not an
    attribution continuation, that run pulled back over a short narrative
    lead-in ("Whereupon Polemarchus said,"), any TEI paragraph break, and the
    section's own start. Offsets are section-local, ascending and unique.

    Sentence starts join them as weaker evidence (`kind == "sentence"`, scored
    down in `default_scores`). They have to: Perseus' Shorey marks a spoken run
    only where the Loeb printed quotation marks, and it prints none through the
    long dialectical stretches — 524c is eight Burnet paragraphs of question and
    answer with no `<q>` anywhere in it, where the turn boundaries survive as
    sentence boundaries and nothing else. A sentence start inside a SHORT spoken
    run is dropped: there the markup is present and says the turn continues.
    Inside a long one it stands — see `SPEECH_SUPPRESS_MAX`.
    """
    if not text:
        return []
    speech: list[int] = []
    speech_end: list[int] = []
    paragraphs: list[int] = []
    for m in markers or []:
        kind = m.get("kind")
        off = m.get("offset", 0)
        if kind == "speech":
            speech.append(off)
        elif kind == "speech-end":
            speech_end.append(off)
        elif kind == "paragraph":
            paragraphs.append(off)
    speech.sort()
    speech_end.sort()
    paragraphs.sort()
    # Any speech boundary blocks a pull-back: a lead-in that itself contains
    # quoted words is the tail of the previous turn, not narration.
    bounds = sorted(speech + speech_end)

    picked: dict[int, str] = {0: "start"}
    prev_end: int | None = None
    for s in speech:
        # The end of the run that closed most recently before `s`.
        ends = [e for e in speech_end if e <= s]
        prev_end = ends[-1] if ends else None
        if prev_end is not None:
            gap = text[prev_end:s]
            stripped = gap.rstrip()
            if (len(gap) < _MAX_ATTRIB and _has_inquit(gap)
                    and stripped.endswith(_ATTRIB_TAIL)):
                continue                       # same turn, attribution inside
        off = s
        start = _sentence_start(text, s)
        lead = text[start:s]
        if (start < s and len(lead) < _MAX_LEADIN and _has_inquit(lead)
                and not any(start < b < s for b in bounds)
                and (prev_end is None or start >= prev_end)):
            off = start                        # "Whereupon Polemarchus said,"
        picked.setdefault(off, "speech")
    for p in paragraphs:
        picked.setdefault(p, "paragraph")
    runs = _pair_runs(speech, speech_end, len(text))
    quiet = [(s, e) for s, e in runs
             if e - s < SPEECH_SUPPRESS_MAX and s > 0 and e < len(text)]
    for m in _SENT_END.finditer(text):
        off = m.end()
        if any(s < off < e for s, e in quiet):
            continue                         # mid-utterance, the markup says so
        picked.setdefault(off, "sentence")

    out: list[Candidate] = []
    for off in sorted(picked):
        if not 0 <= off < len(text) or not text[off:].strip():
            continue                           # a row must get some English
        out.append(Candidate(off, picked[off], text[off:off + _CUE_HEAD]))
    return out


# How far back into the previous section's chunk a section's opening mark may
# reach. Perseus' English section milestone is Shorey's page break, not Burnet's
# paragraph, and it lands LATER than the Greek one at many boundaries: 328a's
# first Burnet paragraph is "Καὶ ὁ Ἀδείμαντος…", whose English ("Do you mean to
# say, interposed Adeimantus,") is the last clause of the 327c chunk. Cut inside
# the section only and the row opens mid-sentence — 148 of the Republic's 158
# lowercase-opening rows were a section's FIRST mark. Two sentences of slack is
# as much drift as the boundaries show and short enough not to offer the
# previous turn as a candidate.
CARRY_TAIL = 200


def with_carry(prev_text: str, prev_markers: list[dict],
               text: str, markers: list[dict], *, after: int = 0,
               tail: int = CARRY_TAIL) -> tuple[str, int, list[Candidate]]:
    """(extended English, carry length, candidates) for one section.

    The section's English opened out into the last `tail` characters of the
    previous section's chunk, joined by the single space the book's prose is
    joined with, so a mark that opens a section can cut before the milestone.
    Every candidate offset indexes the returned string; the carry length is what
    `match_section` needs to keep the position prior measured on the SECTION and
    not on the extension, and what the caller needs to rebase an offset.

    `after` is where the previous row starts in `prev_text`: a carried cut has
    to fall strictly after it and leave it some English of its own, so nothing
    earlier is offered and the caller's rows stay in order without merging.
    Which marks may reach back at all is `default_scores`' business.
    """
    own = candidates_for_chunk(text, markers)
    if not prev_text or not text or tail <= 0:
        return text, 0, own
    start = max(0, len(prev_text) - tail)
    carry = prev_text[start:] + " "
    ext = carry + text
    out = [Candidate(c.offset - start, c.kind,
                     ext[c.offset - start:c.offset - start + _CUE_HEAD])
           for c in candidates_for_chunk(prev_text, prev_markers)
           if c.offset >= max(start, after + 1)
           and prev_text[after:c.offset].strip()]
    # Kind "start" pays no penalty, and while the milestone is a section's only
    # opening that is right. Against a tail it is not: where the previous chunk
    # ends mid-sentence the milestone is Shorey's page break falling inside a
    # turn, and it should compete with that sentence's own start on equal terms
    # rather than outrank it. It still wins where Shorey ran the Greek paragraph
    # into the sentence before it (327c).
    if own and own[0].offset == 0 and own[0].kind == "start" \
            and _sentence_start(ext, len(carry)) < len(carry):
        own = [Candidate(0, "sentence", own[0].cue)] + own[1:]
    out += [Candidate(c.offset + len(carry), c.kind, c.cue) for c in own]
    return ext, len(carry), out


# ── cue table ────────────────────────────────────────────────────────────────

# Perseus' Greek writes the elided apostrophe as U+02BC; other sources use
# U+1FBD, U+2019, or the combining comma above (U+0313, also used to render a
# smooth breathing) sitting on the elided consonant. Fold all of them, BEFORE
# the combining-mark strip below -- U+0313 is itself a combining mark, so left
# unmapped it would simply vanish there rather than survive as an apostrophe.
_APOS = dict.fromkeys(map(ord, "ʼ᾽’‘'`̓"), "'")


def fold(s: str) -> str:
    """Accent-, breathing- and apostrophe-insensitive lowercase."""
    s = s.translate(_APOS)
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return unicodedata.normalize("NFC", s).lower()


# Speakers of the Republic whose Perseus gloss is blank (proper names carry no
# short definition), keyed on the folded stem shared by their declined forms.
NAMES: dict[str, str] = {
    "γλαυκων": "Glaucon",
    "αδειμαντ": "Adeimantus",
    "πολεμαρχ": "Polemarchus",
    "κεφαλ": "Cephalus",
    "θρασυμαχ": "Thrasymachus",
    "κλειτοφ": "Cleitophon",
    "σωκρατ": "Socrates",
    "νικηρατ": "Niceratus",
    "λυσια": "Lysias",
    "ευθυδημ": "Euthydemus",
    "χαρμαντιδ": "Charmantides",
}

# Most of the stems above are distinctive enough that a bare substring match
# carries no real collision risk (declined forms of Σωκράτης, say, never run
# into an unrelated common word). κεφαλ (Cephalus) is the one on record that
# does: it is also the prefix of κεφαλή "head" and κεφάλαιον "chief point",
# ordinary nouns that turn up constantly in Republic I's own imagery. Guard
# only that stem -- requiring one of its ordinary 2nd-declension endings
# right after it (folded, so ῳ already reads as ω), or else nothing at all
# before the next word boundary -- rather than adding the same restriction to
# every stem: most of the OTHER names decline in ways that restriction would
# silently stop matching (Σωκράτης alone has four un-2nd-declension endings
# across its cases; Κλειτοφῶν's nominative doesn't even carry one of these).
_NAME_ENDINGS: dict[str, re.Pattern] = {
    "κεφαλ": re.compile(r"κεφαλ(?:ος|ου|ω|ον|ε)?\b"),
}


def _find_name(stem: str, text: str) -> int | None:
    """Position of `stem`'s name in `text`, or None if absent.

    A guarded stem (see `_NAME_ENDINGS`) must match its own declension; every
    other stem is a plain substring search, exactly as before."""
    pattern = _NAME_ENDINGS.get(stem)
    if pattern is not None:
        m = pattern.search(text)
        return m.start() if m else None
    idx = text.find(stem)
    return idx if idx >= 0 else None


# The Phaedo's cast. Its narration attributes every speech by name (ἔφη ὁ
# Σιμμίας, ἦ δ' ὃς ὁ Κέβης, ἔφη ὁ Κρίτων), so these carry the same weight the
# Republic's names do above. They are matched CASE-SENSITIVELY on the
# accent-stripped text (`fold_cased`), not on the lowercase fold: Κρίτων and
# κριτῶν "of the judges" fold to the same letters, and the capital is what
# tells them apart. Both editions capitalise names, so the guard costs the
# other stems nothing — and it keeps these entries inert for every work that
# never names them (the Republic build is unchanged by their presence).
NAMES_CASED: dict[str, str] = {
    "Σιμμι": "Simmias",
    "Κεβη": "Cebes",
    "Κριτων": "Crito",
    "Φαιδων": "Phaedo",
    "Εχεκρατ": "Echecrates",
    "Απολλοδωρ": "Apollodorus",
    "Ξανθιππ": "Xanthippe",
    "Ευην": "Evenus",
    "Κριτοβουλ": "Critobulus",
}


def fold_cased(s: str) -> str:
    """`fold` without the lowercasing: accents, breathings and apostrophes
    normalised, capitals kept."""
    s = s.translate(_APOS)
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return unicodedata.normalize("NFC", s)


def _cased_names(text: str) -> list[tuple[int, str]]:
    """(position, English name) for each `NAMES_CASED` stem in `text`."""
    cased = fold_cased(text)
    return [(pos, english) for stem, english in NAMES_CASED.items()
            if (pos := cased.find(stem)) != -1]

_GK_FIRST = re.compile(r"ην δ'\s?εγω|ειπον|εφην|ην δε εγω")
_GK_THIRD = re.compile(r"εφη|η δ'\s?ος|εφατο|ελεξεν")

_EN_FIRST = re.compile(
    r"\b(?:said i|i said|i replied|i asked|i rejoined|i inquired|i answered"
    r"|i observed|i remarked|i added|i continued|i put in)\b", re.I)
_EN_THIRD = re.compile(
    r"\b(?:he said|said he|he replied|he asked|she said|said she|he rejoined"
    r"|he interposed|he answered|he objected|he added|he continued|he cried"
    r"|he exclaimed|he observed|he remarked|he retorted|he assented"
    r"|he agreed|he declared|he urged|he put in|he laughed)\b", re.I)
_EN_NAME = re.compile(
    r"\b(?:said|replied|asked|answered|rejoined|interposed|exclaimed|cried"
    r"|added|continued|resumed|observed|remarked|retorted|declared|urged"
    r"|assented|agreed|objected|laughed|put in|broke in)\s+"
    r"(glaucon|adeimantus|polemarchus|cephalus|thrasymachus|cleitophon"
    r"|kleitophon|socrates|niceratus|lysias|euthydemus|charmantides"
    r"|simmias|cebes|crito|phaedo|echecrates|apollodorus|xanthippe|evenus"
    r"|critobulus)\b"
    r"|\b(glaucon|adeimantus|polemarchus|cephalus|thrasymachus|cleitophon"
    r"|kleitophon|socrates|niceratus|lysias|euthydemus|charmantides"
    r"|simmias|cebes|crito|phaedo|echecrates|apollodorus|xanthippe|evenus"
    r"|critobulus)\s+"
    r"(?:said|replied|asked|answered|rejoined|interposed|exclaimed|cried"
    r"|added|continued|resumed|observed|remarked|retorted|declared|urged"
    r"|assented|agreed|objected|laughed)\b", re.I)

# Stock replies. A short Greek paragraph that is one of these should land on an
# English row that opens with one of its renderings; the pair is worth more
# than any lexical signal a three-word paragraph can offer.
_REPLIES: tuple[tuple[re.Pattern, tuple[str, ...]], ...] = (
    (re.compile(r"^ναι\b"), ("yes",)),
    (re.compile(r"^πως γαρ ου"),
     ("of course", "surely", "why not", "how could", "how should",
      "certainly", "yes indeed", "necessarily", "how could it not")),
    (re.compile(r"^πανυ (?:μεν ουν|γε)"),
     ("certainly", "assuredly", "quite so", "by all means", "yes indeed",
      "most assuredly", "quite", "yes")),
    (re.compile(r"^(?:αληθη|ορθως|αληθεστατα|ορθοτατα|ορθως γε)"),
     ("true", "you are right", "right", "quite right", "that is true",
      "very true", "most true", "yes", "correct", "rightly")),
    (re.compile(r"^ουδαμως"),
     ("nohow", "by no means", "not at all", "in no way", "no")),
    (re.compile(r"^(?:εστι ταυτα|ουτως|ουτω)\b"),
     ("that is so", "so it is", "that's the way", "yes", "even so")),
    (re.compile(r"^ειεν\b"),
     ("humph", "very well", "well", "so be it", "granted", "all right",
      "good", "enough")),
    (re.compile(r"^πως(?: δη)?[;,.]?$|^πως λεγεις|^πως τουτο"),
     ("how", "what do you mean", "in what way", "how so", "what")),
    (re.compile(r"^παντ(?:απασι|ελως)"),
     ("by all means", "altogether", "absolutely", "most certainly",
      "entirely", "wholly", "quite so", "yes")),
    (re.compile(r"^τι μην"),
     ("surely", "of course", "what else", "certainly", "yes", "how not",
      "why not", "necessarily")),
    (re.compile(r"^(?:ου πανυ|ηκιστα)"),
     ("no", "not at all", "why, no", "by no means", "not much",
      "not particularly", "hardly", "least of all")),
    (re.compile(r"^(?:εικος|εοικεν?)\b"),
     ("it seems", "probably", "likely", "so it seems", "apparently",
      "it looks", "yes")),
    (re.compile(r"^(?:συμφημι|ομολογω|δοκει|δοκει μοι)\b"),
     ("i agree", "i think so", "yes", "agreed", "i concur", "so it seems")),
    # Fowler's Phaedo answers ἀνάγκη with "Necessarily"; Shorey's Republic
    # with that, "It must be so" or "Of necessity".
    (re.compile(r"^αναγκη\b"),
     ("necessarily", "it must", "of necessity", "inevitably", "yes",
      "certainly", "that must", "there must", "it is necessary")),
)


def _reply_regex(renderings: tuple[str, ...]) -> re.Pattern:
    """A rendering hits only as a whole word at the very start of the
    candidate -- `startswith` alone let "Not a bad guess" register as an
    οὐδαμῶς hit because it starts with the letters "no". The bare "no"
    rendering is further restricted to where it stands alone as the reply
    itself ("No." "No," "No;"), not the opening word of an unrelated
    sentence ("No one saw...", where a plain `\\b` after "no" still holds)."""
    frags = [r"no(?=[.,;]|$)" if r == "no" else re.escape(r) for r in renderings]
    return re.compile(r"(?:%s)\b" % "|".join(frags))


# Parallel to `_REPLIES`, one compiled English matcher per entry.
_REPLY_MATCHERS: tuple[re.Pattern, ...] = tuple(
    _reply_regex(renderings) for _, renderings in _REPLIES
)

_HEAD = 80        # chars of a Greek paragraph that can carry its attribution

CUE_BOTH_FIRST = 0.50
CUE_BOTH_THIRD = 0.35
CUE_NAME_HIT = 0.60
CUE_CONTRADICT = -0.40
CUE_MISSING = -0.10
CUE_REPLY_HIT = 0.60
CUE_REPLY_MISS = -0.15


def _greek_cue(text: str) -> tuple[str | None, str | None]:
    """(person, name) the Greek paragraph's attribution announces."""
    head = fold(text[:_HEAD])
    # The EARLIEST name in the head wins, as on the English side: 327c's opening
    # paragraph names Polemarchus first and Glaucon only as Adeimantus' father,
    # and taking Glaucon paired it with "So we will, said Glaucon," — the turn
    # BEFORE the one it opens.
    at = [(pos, english)
          for stem, english in NAMES.items()
          if (pos := _find_name(stem, head)) is not None]
    at += _cased_names(text[:_HEAD])
    name = min(at)[1] if at else None
    if _GK_FIRST.search(head):
        return "first", name
    if _GK_THIRD.search(head):
        return "third", name
    return None, name


def _english_cue(head: str) -> tuple[str | None, str | None]:
    """(person, name) the English candidate's attribution announces.

    The EARLIEST attribution in the head wins: the one nearest the opening is
    this turn's, any later one belongs to the turn after it."""
    m = _EN_NAME.search(head)
    name = None
    if m:
        name = (m.group(1) or m.group(2) or "").capitalize()
        if name == "Kleitophon":
            name = "Cleitophon"
    first = _EN_FIRST.search(head)
    third = _EN_THIRD.search(head)
    at = [(mm.start(), person)
          for mm, person in ((first, "first"), (third, "third"), (m, "third"))
          if mm is not None]
    if not at:
        return None, name
    return min(at)[1], name


def cue_score(greek: str, english_head: str) -> float:
    """Attribution agreement between a Greek paragraph and an English opening."""
    gp, gn = _greek_cue(greek)
    ep, en = _english_cue(english_head)
    score = 0.0

    folded = fold(greek).strip()
    low = english_head.lower().lstrip()
    for (pattern, _renderings), reply_re in zip(_REPLIES, _REPLY_MATCHERS):
        if pattern.match(folded) and len(folded) < 40:
            if reply_re.match(low):
                score += CUE_REPLY_HIT
            else:
                score += CUE_REPLY_MISS
            break

    if gn and en:
        score += CUE_NAME_HIT if gn == en else CUE_CONTRADICT
    elif gp and ep:
        if gp == ep:
            score += CUE_BOTH_FIRST if gp == "first" else CUE_BOTH_THIRD
        else:
            score += CUE_CONTRADICT
    elif gp and not ep:
        score += CUE_MISSING
    return score


# ── scoring and the DP ───────────────────────────────────────────────────────

W_LEX = 2.00
W_POS = 1.00
POS_BAND = 0.25        # section-milestone drift this large is normal
W_QUESTION = 0.06
W_RATIO = 0.10        # paragraph-length agreement, weakly
W_SENTENCE = 0.15      # a bare sentence start is weaker than a marked speech
GAP = -0.35            # cost of leaving a Greek mark unmatched
# A three-word paragraph's expected English is three words long, which is too
# little text to score; give every window some slack and a floor.
_WINDOW_SLACK = 1.25
_MIN_WINDOW = 60

# Reaching into the previous chunk (see `with_carry`) is for a mark whose Greek
# paragraph OPENS its section — that is the only mark whose English can be
# earlier than the milestone. A run of one-word replies can put two or three
# marks inside the section's first breath (413b opens with three), so allow a
# few, and only while the Greek is still within the same slack the English tail
# gives. Monotonicity does the rest: a mark can only reach back if every matched
# mark before it did too.
CARRY_MAX_MARKS = 3
CARRY_MAX_GREEK = CARRY_TAIL
_FORBID = -1e9         # a pairing the DP must not take

_WORD = re.compile(r"[A-Za-z]+")
_SUFFIX = ("ations", "ation", "ings", "ing", "edly", "edness", "ness",
           "ments", "ment", "ed", "es", "s", "ly", "est", "er")


def stem(word: str) -> str:
    """Crude suffix strip, applied to BOTH sides of the gloss bridge.

    The glosses are dictionary head-forms ("separate, divide", "confound") and
    the translation is running prose ("separated", "confounded"), so an exact
    token match throws away most of the signal there is."""
    w = word.lower()
    for suf in _SUFFIX:
        if w.endswith(suf) and len(w) - len(suf) >= 3:
            w = w[:-len(suf)]
            break
    if len(w) > 3 and w.endswith("e"):
        w = w[:-1]
    return w


def _stemmed(text: str) -> str:
    return " ".join(stem(w) for w in _WORD.findall(text))


def gloss_bag(mark: MarkFeat) -> str:
    """The English words a Greek paragraph is expected to surface as."""
    words = []
    for g in mark.glosses:
        words.extend(_WORD.findall(g))
    folded = fold(mark.text)
    for stem_, english in NAMES.items():
        if _find_name(stem_, folded) is not None:
            words.append(english)
    words.extend(english for _, english in _cased_names(mark.text))
    return " ".join(stem(w) for w in words)


def _windows(greek: list[MarkFeat], english: list[Candidate],
             greek_len: int, english_text: str, carry: int = 0) -> list[list[str]]:
    """English text at each candidate, as long a share of the section as the
    Greek paragraph is of its own side. Length-normalising here is what keeps a
    pair's score independent of which candidate the DP chooses next."""
    elen = len(english_text) - carry
    out: list[list[str]] = []
    for i, m in enumerate(greek):
        end = greek[i + 1].offset if i + 1 < len(greek) else greek_len
        share = (end - m.offset) / greek_len if greek_len else 0.0
        width = max(_MIN_WINDOW, round(_WINDOW_SLACK * share * elen))
        out.append([english_text[c.offset:c.offset + width] for c in english])
    return out


def default_scores(greek: list[MarkFeat], english: list[Candidate],
                   greek_len: int, english_text: str,
                   carry: int = 0) -> list[list[float]]:
    """The full mark x candidate score matrix.

    `carry` is how much of `english_text` belongs to the previous section (see
    `with_carry`): positions are measured from there on, so a candidate inside
    the carry sits at a negative fraction of the section, and only a mark at the
    section's head may be paired with one at all."""
    if not greek or not english:
        return [[0.0] * len(english) for _ in greek]
    windows = _windows(greek, english, greek_len, english_text, carry)
    refs = [gloss_bag(m) for m in greek]
    flat = [_stemmed(w) for row in windows for w in row]
    sim = similarity.cos_matrix(refs, flat, "lexical")
    elen = (len(english_text) - carry) or 1
    glen = greek_len or 1

    # Each candidate's share of the section's English, measured to the next
    # candidate. Only a weak signal — the DP may skip that next candidate, so
    # the share understates — but it separates a mark whose paragraph is the
    # length of the English run from one two turns too short for it.
    eshare = []
    for j, c in enumerate(english):
        end = english[j + 1].offset if j + 1 < len(english) else len(english_text)
        if c.offset < carry <= end:
            # A carried candidate's row always runs past the milestone, so its
            # share is measured to the first cut BEYOND it. Measured to the
            # milestone instead — eleven characters, at 337c/337d — the ratio
            # term buries the very cut the carry exists to offer.
            end = next((d.offset for d in english[j + 1:] if d.offset > carry),
                       len(english_text))
        eshare.append(max(1, end - c.offset) / elen)

    out: list[list[float]] = []
    for i, m in enumerate(greek):
        row: list[float] = []
        gfrac = m.offset / glen
        gq = m.text.count(";")
        gshare = max(1, len(m.text)) / glen
        reaches_back = i < CARRY_MAX_MARKS and m.offset <= CARRY_MAX_GREEK
        for j, c in enumerate(english):
            if c.offset < carry and not reaches_back:
                row.append(_FORBID)
                continue
            lex = sim[i][i * len(english) + j]
            score = W_LEX * lex
            score += cue_score(m.text, c.cue)
            score -= W_POS * max(0.0, abs(gfrac - (c.offset - carry) / elen)
                                 - POS_BAND)
            score -= W_QUESTION * min(3, abs(gq - windows[i][j].count("?")))
            score -= W_RATIO * min(3.0, abs(math.log(gshare / eshare[j])))
            if c.kind == "sentence":
                score -= W_SENTENCE
            row.append(score)
        out.append(row)
    return out


def match_section(greek: list[MarkFeat], english: list[Candidate], *,
                  greek_len: int, english_text: str, carry: int = 0,
                  scores: list[list[float]] | None = None,
                  ) -> list[int | None]:
    """Match each Greek mark to at most one English candidate, in order.

    Returns one entry per Greek mark: the index of its candidate, or None when
    the mark has no English counterpart worth cutting at (it merges into the
    previous row upstream). Candidates may be passed over freely. `carry` is the
    leading part of `english_text` belonging to the previous section, as
    `with_carry` returns it.
    """
    M, C = len(greek), len(english)
    if not M:
        return []
    if not C:
        return [None] * M
    sim = default_scores(greek, english, greek_len, english_text, carry) \
        if scores is None else scores

    NEG = float("-inf")
    dp = [[NEG] * (C + 1) for _ in range(M + 1)]
    bk = [["."] * (C + 1) for _ in range(M + 1)]
    for j in range(C + 1):
        dp[0][j] = 0.0
        bk[0][j] = "left"
    for i in range(1, M + 1):
        dp[i][0] = i * GAP
        bk[i][0] = "up"
    for i in range(1, M + 1):
        for j in range(1, C + 1):
            diag = dp[i - 1][j - 1] + sim[i - 1][j - 1]
            up = dp[i - 1][j] + GAP          # this Greek mark goes unmatched
            left = dp[i][j - 1]              # this candidate goes unused
            best = max(diag, up, left)
            dp[i][j] = best
            bk[i][j] = "diag" if best == diag else ("up" if best == up else "left")

    out: list[int | None] = [None] * M
    i, j = M, C
    while i > 0:
        move = bk[i][j]
        if move == "diag":
            out[i - 1] = j - 1
            i -= 1
            j -= 1
        elif move == "up":
            i -= 1
        else:
            j -= 1
    return out
