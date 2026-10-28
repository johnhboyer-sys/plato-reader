"""Drop spurious Morpheus secondary readings from a token's analyses.

Morpheus emits every homonym candidate it can generate, unranked. For Attic
prose like Aristotle this includes obvious noise — a Doric masculine reading of
a feminine proper noun (Εὐρώπης), a back-formed alternate lemma sharing the same
gloss as the real one (ἡδονά beside ἡδονή), etc. These surface in the word popup
as extra parse cards, often with no dictionary headword at all.

The filter is deliberately conservative. An analysis with no LSJ match is
removed only when BOTH:
  * the same token has at least one LSJ-backed reading (so something real
    remains), AND
  * the unresolved reading is redundant — it has no gloss, or its gloss exactly
    duplicates a resolved sibling's gloss.

Genuine alternative lemmas (an unresolved reading with a *distinct* gloss, e.g.
ἐφαιρέομαι beside πέλω) and wholly unresolved words (rare terms, proper names not
in LSJ) are always kept. No token is ever left with zero analyses.

The readings that remain are then ranked (rank_parses) and, for a few hand-
reviewed forms, corrected from morphology_overrides.json: the first reading is
the one a token is filed under, and Morpheus's own order is alphabetical.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

def filter_parses(parses: list[dict]) -> list[dict]:
    """Return `parses` with redundant unresolved readings removed.

    Each parse is a dict with at least `gloss` (str) and `lsj` (list) keys.
    """
    has_resolved = any(p["lsj"] for p in parses)
    if not has_resolved:
        return parses

    resolved_glosses = {
        p["gloss"].strip() for p in parses if p["lsj"] and p["gloss"].strip()
    }

    kept = []
    for p in parses:
        gloss = p["gloss"].strip()
        redundant = (not p["lsj"]) and (not gloss or gloss in resolved_glosses)
        if not redundant:
            kept.append(p)
    return kept


# The dialects Morpheus names in a parse: "fem gen sg (attic epic ionic)",
# "doric aeolic (proclitic indeclform prep)", "poetic indeclform (prep)".
_DIALECTS = frozenset(
    {"attic", "doric", "aeolic", "epic", "ionic", "homeric", "poetic"}
)


def _non_attic_only(parse: str) -> bool:
    """Morpheus marks the reading for dialects, and Attic is not among them."""
    named = _DIALECTS.intersection(re.findall(r"[a-z]+", parse))
    return bool(named) and "attic" not in named


def rank_parses(parses: list[dict]) -> list[dict]:
    """Move readings Morpheus marks only for non-Attic dialects behind the rest.

    Diogenes stores a form's readings in alphabetical order of their lemmas,
    and the first reading is the one a token is filed under: the lexicon page
    that counts it, the word card that opens first. So a rare word that sorts
    first takes another word's forms: ἀρετῆς and ἀρετῇ went to Doric
    contractions of ἀρετάω 'thrive' ("a)reta/w" sorts before "a)reth/"),
    ψυχῆς to a Doric future of ψυχάζω, οἱ to the epic pronoun ἑ, εἴη to a
    Doric imperfect of ἐάω. Plato writes Attic, so a reading marked Doric,
    Aeolic, epic, Ionic, Homeric or poetic, and not Attic, goes behind every
    Attic or unmarked reading.

    The sort is stable: Morpheus's order stands within each group, and a token
    whose readings are all non-Attic keeps its order. Morpheus marks some
    Attic forms non-Attic (δόξαν only Doric/Aeolic, σκιάς only Ionic); the
    override table puts those back.
    """
    return sorted(parses, key=lambda p: _non_attic_only(p["parse"]))


_OVERRIDE_PATH = Path(__file__).with_name("morphology_overrides.json")


def load_morphology_overrides(path: Path = _OVERRIDE_PATH) -> dict[str, dict]:
    """Load and validate the curated surface-form overrides.

    morphology_overrides.json is a plain JSON list, reviewed by hand, in the
    format of aristotle-reader's table of the same name; that table also fixes
    junk glosses, and this one so far only moves readings. Each entry is an
    object with these fields, all Perseus Beta Code or English, matched
    exactly (case-sensitive, no normalisation):

      surface        the token as the Morpheus table (Diogenes'
                     greek-analyses.txt) spells its key: "do/can", "oi(/".
                     Required; unique in the file.
      lemma          a Morpheus lemma as the table spells it ("do/ca").
                     Required.
      parse          a Morpheus parse string exactly as the table spells it
                     ("aor subj act 3rd sg"), dialect notes included.
                     Optional.
      justification  why, in a line an editor can check. Required.

    The target is the first reading whose lemma equals `lemma` and, when
    `parse` is given, whose parse equals `parse`. It moves to the front whole,
    with its own parse, gloss and LSJ keys; the others keep their order. If it
    is already first, or no reading matches, nothing moves.
    """
    entries = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(entries, list):
        raise ValueError(f"{path}: expected a JSON list")

    overrides = {}
    required = {"surface", "lemma", "justification"}
    allowed = required | {"parse"}
    for entry in entries:
        if not isinstance(entry, dict) or not required <= entry.keys():
            raise ValueError(
                f"{path}: every override needs surface, lemma and justification"
            )
        surface = entry["surface"]
        if set(entry) - allowed:
            raise ValueError(f"{path}: invalid override fields for {surface}")
        if not all(isinstance(v, str) and v for v in entry.values()):
            raise ValueError(f"{path}: override values must be non-empty strings")
        if surface in overrides:
            raise ValueError(f"{path}: duplicate surface {surface}")
        overrides[surface] = entry
    return overrides


MORPHOLOGY_OVERRIDES = load_morphology_overrides()


def apply_morphology_override(
    parses: list[dict],
    surface: str | None,
    overrides: dict[str, dict] = MORPHOLOGY_OVERRIDES,
) -> list[dict]:
    """Move the reading the surface's override names to the front, by the
    rules in load_morphology_overrides. Returns the input unchanged when the
    surface has no entry or no reading matches; never mutates it."""
    override = overrides.get(surface) if surface is not None else None
    if override is None:
        return parses

    lemma, parse = override["lemma"], override.get("parse")
    index = next(
        (i for i, reading in enumerate(parses)
         if reading["lemma"] == lemma
         and (parse is None or reading["parse"] == parse)),
        None,
    )
    if index is None:
        return parses
    return [parses[index], *parses[:index], *parses[index + 1 :]]
