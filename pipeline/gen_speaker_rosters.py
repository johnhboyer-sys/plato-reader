#!/usr/bin/env python3
"""Generate the Plato speaker rosters and write them into the work manifests.

For turn-level Greek↔English dialogue alignment each dialogue manifest needs a
`speakers:` block that maps BOTH sides onto one canonical display name:

    speakers:
      sigla:            # Greek OCT siglum -> canonical English name
        "ΣΩ.": Socrates
        "ΕΥΘ.": Euthyphro
      who_aliases:      # only where the English @who spelling drifts
        Cephalos: Cephalus
      nested: inner     # only where the OCT dash-marks inner reported turns

The Greek sigla are harvested from the built spine (build/dist/<work>/*.json);
the English @who set and print labels are read from the vendored Perseus TEI.
The canonical name for each siglum is curated below from standard classical
knowledge and VALIDATED to appear in that work's @who set (bare "—" excepted).
The harvest is also dumped to docs/speaker-rosters-raw.json for review.

Usage:  python -m plato_pipeline ...   (no) — run directly:
    pipeline/.venv/bin/python pipeline/gen_speaker_rosters.py [--write]
Without --write it only reports; with --write it rewrites the `speakers:` block
of every dialogue manifest in place (preserving surrounding comments).
"""
from __future__ import annotations

import glob
import json
import re
import sys
from collections import Counter
from pathlib import Path

import yaml
from lxml import etree

ROOT = Path(__file__).resolve().parents[1]

# Curated Greek siglum -> canonical English name, per work. Each name is checked
# against the work's @who set below. Works absent here (Apology, Charmides,
# Letters, Lovers, Republic) carry 0 Greek turn events — narrated throughout —
# so they build no turn alignment and need no roster.
ROSTERS: dict[str, dict[str, str]] = {
    "Alcibiades1": {"ΣΩ.": "Socrates", "ΑΛ.": "Alcibiades"},
    "Alcibiades2": {"ΣΩ.": "Socrates", "ΑΛ.": "Alcibiades"},
    "Clitophon": {"ΣΩ.": "Socrates", "ΚΛΕΙ.": "Cleitophon"},
    "Cratylus": {"ΣΩ.": "Socrates", "ΕΡΜ.": "Hermogenes", "ΚΡ.": "Cratylus"},
    "Critias": {"ΣΩ.": "Socrates", "ΤΙ.": "Timaeus", "ΕΡ.": "Hermocrates",
                "ΚΡ.": "Critias", "ΚΡΙ.": "Critias"},
    "Crito": {"ΣΩ.": "Socrates", "ΚΡ.": "Crito"},
    "Epinomis": {"ΑΘ.": "Athenian", "ΚΛ.": "Cleinias"},
    "Euthydemus": {"ΣΩ.": "Socrates", "ΚΡ.": "Crito"},
    "Euthyphro": {"ΣΩ.": "Socrates", "ΕΥΘ.": "Euthyphro"},
    "Gorgias": {"ΣΩ.": "Socrates", "ΓΟΡ.": "Gorgias", "ΚΑΛ.": "Callicles",
                "ΠΩΛ.": "Polus", "ΧΑΙ.": "Chaerephon"},
    "Hipparchus": {"ΣΩ.": "Socrates", "ΕΤ.": "Friend"},
    "HippiasMajor": {"ΣΩ.": "Socrates", "ΙΠ.": "Hippias"},
    "HippiasMinor": {"ΣΩ.": "Socrates", "ΙΠ.": "Hippias", "ΕΥ.": "Eudicus"},
    "Ion": {"ΣΩ.": "Socrates", "ΙΩΝ.": "Ion"},
    "Laches": {"ΣΩ.": "Socrates", "ΛΑ.": "Laches", "ΛΥ.": "Lysimachus",
               "ΜΕ.": "Melesias", "ΝΙ.": "Nicias",
               "ΠΑΙ.": "Sons of Lysimachus and Melesias"},
    "Laws": {"ΑΘ.": "Athenian", "ΚΛ.": "Clinias", "ΜΕ.": "Megillus"},
    "Menexenus": {"ΣΩ.": "Socrates", "ΜΕΝ.": "Menexenus"},
    "Meno": {"ΣΩ.": "Socrates", "ΜΕΝ.": "Meno", "ΑΝ.": "Anytus",
             "ΠΑΙ.": "Meno's Boy"},
    "Minos": {"ΣΩ.": "Socrates", "ΕΤ.": "Companion"},
    "Phaedo": {"ΕΧ.": "Echecrates", "ΦΑΙΔ.": "Phaedo"},
    "Phaedrus": {"ΣΩ.": "Socrates", "ΦΑΙ.": "Phaedrus"},
    "Philebus": {"ΣΩ.": "Socrates", "ΠΡΩ.": "Protarchus", "ΦΙ.": "Philebus"},
    "Protagoras": {"ΣΩ.": "Socrates", "ΕΤ.": "Friend"},
    "Sophist": {"ΣΩ.": "Socrates", "ΘΕΑΙ.": "Theaetetus", "ΘΕΟ.": "Theodorus",
                "ΞΕ.": "Stranger"},
    "Statesman": {"ΣΩ.": "Socrates", "ΘΕΟ.": "Theodorus", "ΞΕ.": "Stranger",
                  "ΝΕ. ΣΩ.": "Younger Socrates"},
    "Symposium": {"ΑΠΟΛ.": "Apollodorus", "ΕΤΑΙ.": "Companion"},
    "Theaetetus": {"ΣΩ.": "Socrates", "ΘΕΑΙ.": "Theaetetus", "ΘΕΟ.": "Theodorus",
                   "ΕΥ.": "Eucleides", "ΤΕΡ.": "Terpsion"},
    "Theages": {"ΣΩ.": "Socrates", "ΔΗ.": "Demodocus", "ΘΕ.": "Theages"},
    "Timaeus": {"ΣΩ.": "Socrates", "ΤΙ.": "Timaeus", "ΕΡ.": "Hermocrates",
                "ΚΡ.": "Critias"},
    # Wholly dash-driven Greek (the OCT marks every turn with a bare "—"): no
    # sigla to map, but the work still pairs at the dash/null level.
    "Lysis": {},
    "Parmenides": {},
}

# @who spellings that drift from the canonical display name.
WHO_ALIASES: dict[str, dict[str, str]] = {
    "Parmenides": {"Cephalos": "Cephalus"},
    "Laws": {"Ἀθηναῖος": "Athenian"},
}

# Works whose Greek OCT dash-marks the inner reported turns, so the English
# reported speech should pair at inner level (see stage1_stephanus_english).
NESTED_INNER = {"Euthydemus", "Lysis", "Parmenides", "Protagoras"}


def _local(t) -> str:
    return etree.QName(t).localname if isinstance(t, str) else ""


def _base_siglum(label: str) -> str:
    """Normalise a Greek turn label to its base siglum: strip a leading dash,
    whitespace and a stray '<' (compound resumption markers "— ΣΩ.", "—<ΙΠ.");
    a bare dash normalises to "" (the unattributed turn)."""
    return re.sub(r"^[—\-\s<]+", "", label).strip()


def harvest():
    out = {}
    for p in sorted(glob.glob(str(ROOT / "manifests" / "*.yaml"))):
        data = yaml.safe_load(open(p, encoding="utf-8"))
        if (data.get("citation") or {}).get("scheme") != "stephanus":
            continue
        wid = data["work"]["id"]
        tlg = data["work"]["tlg_work"]
        # Greek sigla from the built spine.
        sig = Counter()
        for f in glob.glob(str(ROOT / "build" / "dist" / wid / "book-*.json")):
            for s in json.load(open(f, encoding="utf-8"))["segments"]:
                for sp in s.get("speakers", []):
                    sig[sp["label"]] += 1
        # English @who set + labels.
        who = Counter()
        labels = Counter()
        n_said = nested = 0
        prim = (data.get("english") or {}).get("primary") or {}
        fp = ROOT / "sources" / prim["file"] if prim.get("file") else None
        if fp and fp.exists():
            body = etree.parse(str(fp)).find(".//{*}body")

            def walk(el, insaid):
                nonlocal n_said, nested
                for ch in el:
                    tag = _local(ch.tag)
                    if tag == "said":
                        n_said += 1
                        nested += insaid
                        who[ch.get("who", "")] += 1
                        walk(ch, True)
                    elif tag == "label":
                        labels[(ch.text or "").strip()] += 1
                        walk(ch, insaid)
                    else:
                        walk(ch, insaid)

            if body is not None:
                walk(body, False)
        out[wid] = {
            "tlg": tlg,
            "greek_sigla": dict(sig),
            "n_greek_events": sum(sig.values()),
            "english_who": dict(who),
            "n_said": n_said,
            "nested_said": nested,
            "english_labels": dict(labels),
        }
    return out


def validate(raw) -> list[str]:
    """Every mapped siglum's name must appear in the work's @who set (after
    aliasing); every observed base siglum must be mapped. Returns problems."""
    problems = []
    for wid, d in raw.items():
        roster = ROSTERS.get(wid)
        if roster is None:
            if d["n_greek_events"]:
                problems.append(f"{wid}: has {d['n_greek_events']} Greek events but no roster")
            continue
        aliases = WHO_ALIASES.get(wid, {})
        # Canonicalise each full @who value the way the walker does (alias per
        # token, keep the value whole — multi-word names like "Younger Socrates"
        # or "Meno's Boy" are ONE speaker, not several).
        who_names = set()
        for w in d["english_who"]:
            canon = " ".join(
                aliases.get(t.lstrip("#"), t.lstrip("#"))
                for t in w.split()
                if t.lstrip("#") and t.lstrip("#") != "-"
            )
            if canon:
                who_names.add(canon)
        for name in roster.values():
            if name not in who_names:
                problems.append(f"{wid}: siglum name {name!r} not in @who set {sorted(who_names)}")
        observed = {_base_siglum(l) for l in d["greek_sigla"]}
        for base in observed:
            if base == "":
                continue  # bare dash — unattributed, no mapping expected
            if base not in roster:
                problems.append(f"{wid}: observed siglum {base!r} is unmapped")
    return problems


_SPK_BLOCK = re.compile(r"(?ms)^speakers:.*?(?=^\S)")


def render_block(wid) -> str:
    roster = ROSTERS.get(wid, {})
    aliases = WHO_ALIASES.get(wid, {})
    lines = ["speakers:"]
    if roster:
        lines.append("  # Greek OCT siglum -> canonical English interlocutor name.")
        lines.append("  sigla:")
        for sig, name in roster.items():
            lines.append(f'    "{sig}": "{name}"')
    else:
        lines.append("  # Wholly dash-driven Greek: turns pair at the null (bare —) level.")
        lines.append("  sigla: {}")
    if aliases:
        lines.append("  # Perseus @who spellings that drift from the display name.")
        lines.append("  who_aliases:")
        for a, b in aliases.items():
            lines.append(f'    "{a}": "{b}"')
    if wid in NESTED_INNER:
        lines.append("  # The OCT dash-marks the inner reported turns; pair them.")
        lines.append("  nested: inner")
    return "\n".join(lines) + "\n\n"


def write_manifests():
    for wid in ROSTERS:
        path = ROOT / "manifests" / f"{wid}.yaml"
        text = path.read_text(encoding="utf-8")
        if not _SPK_BLOCK.search(text):
            print(f"  WARN {wid}: no speakers: block found, skipping")
            continue
        text = _SPK_BLOCK.sub(render_block(wid), text, count=1)
        path.write_text(text, encoding="utf-8")
        print(f"  wrote roster into {path.name}")


def main():
    raw = harvest()
    (ROOT / "docs" / "speaker-rosters-raw.json").write_text(
        json.dumps(raw, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    problems = validate(raw)
    print(f"harvested {len(raw)} stephanus works -> docs/speaker-rosters-raw.json")
    if problems:
        print("VALIDATION PROBLEMS:")
        for p in problems:
            print("  " + p)
    else:
        print("roster validation: all sigla map to an @who name; no unmapped sigla")
    if "--write" in sys.argv:
        write_manifests()
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
