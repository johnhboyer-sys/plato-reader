"""Match a narrated section's Greek paragraph marks to English cut points.

Burnet paragraphs the Republic one turn at a time; Shorey does not — he runs a
whole exchange into one paragraph and marks each speech with quotation marks
instead. `turns.build_para_flow`'s spine mode makes Burnet's marks the row
spine, which needs, per Stephanus section, the point in Shorey's prose that
each Greek mark corresponds to.

This module is that matcher, and nothing else: plain data in, index pairs out.
It knows no TEI, no manifest, no turn model.

    candidates_for_chunk(text, markers) -> [Candidate]   # where English MAY cut
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
    gross disagreement is penalised.
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


def _has_inquit(s: str) -> bool:
    return bool(_INQUIT_RE.search(s))


def _sentence_start(text: str, offset: int) -> int:
    """Start of the sentence containing `offset`."""
    last = 0
    for m in _SENT_END.finditer(text, 0, offset):
        last = m.end()
    return last


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
    sentence boundaries and nothing else. A sentence start INSIDE a spoken run
    is dropped: there the markup is present and says the turn continues.
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
    runs = list(zip(speech, speech_end))     # pairing is positional, as emitted
    for m in _SENT_END.finditer(text):
        off = m.end()
        if any(s < off < e for s, e in runs):
            continue                         # mid-utterance, the markup says so
        picked.setdefault(off, "sentence")

    out: list[Candidate] = []
    for off in sorted(picked):
        if not 0 <= off < len(text) or not text[off:].strip():
            continue                           # a row must get some English
        out.append(Candidate(off, picked[off], text[off:off + _CUE_HEAD]))
    return out


# ── cue table ────────────────────────────────────────────────────────────────

# Perseus' Greek writes the elided apostrophe as U+02BC; other sources use
# U+1FBD or U+2019. Fold all three, and the accents with them.
_APOS = dict.fromkeys(map(ord, "ʼ᾽’‘'`"), "'")


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

_GK_FIRST = re.compile(r"ην δ' εγω|ειπον|εφην|ην δε εγω")
_GK_THIRD = re.compile(r"εφη|η δ' ος|εφατο|ελεξεν")

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
    r"|kleitophon|socrates|niceratus|lysias|euthydemus|charmantides)\b"
    r"|\b(glaucon|adeimantus|polemarchus|cephalus|thrasymachus|cleitophon"
    r"|kleitophon|socrates|niceratus|lysias|euthydemus|charmantides)\s+"
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
    name = None
    for stem, english in NAMES.items():
        if stem in head:
            name = english
            break
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
    for pattern, renderings in _REPLIES:
        if pattern.match(folded) and len(folded) < 40:
            if any(low.startswith(r) for r in renderings):
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
        if stem_ in folded:
            words.append(english)
    return " ".join(stem(w) for w in words)


def _windows(greek: list[MarkFeat], english: list[Candidate],
             greek_len: int, english_text: str) -> list[list[str]]:
    """English text at each candidate, as long a share of the section as the
    Greek paragraph is of its own side. Length-normalising here is what keeps a
    pair's score independent of which candidate the DP chooses next."""
    elen = len(english_text)
    out: list[list[str]] = []
    for i, m in enumerate(greek):
        end = greek[i + 1].offset if i + 1 < len(greek) else greek_len
        share = (end - m.offset) / greek_len if greek_len else 0.0
        width = max(_MIN_WINDOW, round(_WINDOW_SLACK * share * elen))
        out.append([english_text[c.offset:c.offset + width] for c in english])
    return out


def default_scores(greek: list[MarkFeat], english: list[Candidate],
                   greek_len: int, english_text: str) -> list[list[float]]:
    """The full mark x candidate score matrix."""
    if not greek or not english:
        return [[0.0] * len(english) for _ in greek]
    windows = _windows(greek, english, greek_len, english_text)
    refs = [gloss_bag(m) for m in greek]
    flat = [_stemmed(w) for row in windows for w in row]
    sim = similarity.cos_matrix(refs, flat, "lexical")
    elen = len(english_text) or 1
    glen = greek_len or 1

    # Each candidate's share of the section's English, measured to the next
    # candidate. Only a weak signal — the DP may skip that next candidate, so
    # the share understates — but it separates a mark whose paragraph is the
    # length of the English run from one two turns too short for it.
    eshare = []
    for j, c in enumerate(english):
        end = english[j + 1].offset if j + 1 < len(english) else elen
        eshare.append(max(1, end - c.offset) / elen)

    out: list[list[float]] = []
    for i, m in enumerate(greek):
        row: list[float] = []
        gfrac = m.offset / glen
        gq = m.text.count(";")
        gshare = max(1, len(m.text)) / glen
        for j, c in enumerate(english):
            lex = sim[i][i * len(english) + j]
            score = W_LEX * lex
            score += cue_score(m.text, c.cue)
            score -= W_POS * max(0.0, abs(gfrac - c.offset / elen) - POS_BAND)
            score -= W_QUESTION * min(3, abs(gq - windows[i][j].count("?")))
            score -= W_RATIO * min(3.0, abs(math.log(gshare / eshare[j])))
            if c.kind == "sentence":
                score -= W_SENTENCE
            row.append(score)
        out.append(row)
    return out


def match_section(greek: list[MarkFeat], english: list[Candidate], *,
                  greek_len: int, english_text: str,
                  scores: list[list[float]] | None = None,
                  ) -> list[int | None]:
    """Match each Greek mark to at most one English candidate, in order.

    Returns one entry per Greek mark: the index of its candidate, or None when
    the mark has no English counterpart worth cutting at (it merges into the
    previous row upstream). Candidates may be passed over freely.
    """
    M, C = len(greek), len(english)
    if not M:
        return []
    if not C:
        return [None] * M
    sim = default_scores(greek, english, greek_len, english_text) \
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
