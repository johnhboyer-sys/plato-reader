"""Step A: a cast and scene sheet per work, from its English (one Opus call each).

Reads build/speakers-pilot/<Work>.rows.json, writes <Work>.cast.json beside it.
Run with: env -u ANTHROPIC_API_KEY uv run --no-project --with anthropic python scripts/speakers/cast.py Charmides ...
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import anthropic

OUT = Path(__file__).resolve().parents[2] / "build" / os.environ.get("SPEAKERS_RUN", "speakers-pilot")
MODEL = "claude-opus-5-5"

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["narrator", "frame", "cast", "scenes"],
    "properties": {
        "narrator": {"type": "string", "description": "cast id of the main narrator"},
        "frame": {"type": "string", "description": "who tells the story to whom, every level"},
        "cast": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["id", "display", "english", "greek_nominative", "greek_vocative", "role"],
            "properties": {
                "id": {"type": "string", "description": "lowercase ascii, e.g. socrates"},
                "display": {"type": "string", "description": "short siglum as Loeb/OCT print it, e.g. Soc."},
                "english": {"type": "string"},
                "greek_nominative": {"type": "string"},
                "greek_vocative": {"type": "string"},
                "role": {"type": "string", "description": "one line"},
            }}},
        "scenes": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["start", "end", "speakers", "note"],
            "properties": {
                "start": {"type": "string", "description": "Stephanus page+section, e.g. 153a"},
                "end": {"type": "string"},
                "speakers": {"type": "array", "items": {"type": "string"},
                             "description": "cast ids who speak in this stretch"},
                "note": {"type": "string", "description": "who talks with whom; one or two lines"},
            }}},
    },
}

PROMPT = """Below is the English (a Loeb translation) of {span} of Plato's {work}, row by row, each row tagged with its Stephanus reference.

Write the cast and scene sheet that a reader labelling every speech with its speaker will work from:
- narrator and frame: who narrates, to whom, and every level of retelling.
- cast: everyone who speaks in direct speech at any level, including the narrator, people who speak only once, and voices quoted inside a speech: every poet or author quoted (Homer, Hesiod, Pindar, Simonides, Solon, ...), and every recounted voice (Diotima, Er, an old friend's remark). Give the Greek nominative and vocative as Burnet prints them. Ids are lowercase ascii names.
  Add a joint id joined with + (e.g. lysis+menexenus, display "Lys. & Men.") for every group that answers together with a dual or plural verb (ἐφάτην, ἔφασαν).
  Note in role whether a voice is live in the scene, recounted inside someone's speech (say by whom), or imagined by a speaker ("if someone asked", the Muses); imagined voices get no id of their own.
- scenes: consecutive Stephanus stretches covering the whole text, each listing who speaks in it and who talks with whom. Make a new scene whenever the set of speakers changes.

Be exact about Stephanus boundaries; they are used to check labels.

{rows}"""


def main(works: list[str]) -> None:
    client = anthropic.Anthropic()
    for work in works:
        rows = json.loads((OUT / f"{work}.rows.json").read_text())
        books = sorted({r["book"] for r in rows})
        roman = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"]
        span = ("Books " + "–".join(dict.fromkeys([roman[books[0]], roman[books[-1]]]))
                if work in ("Republic", "Laws") else "the whole")
        text = "\n".join(f"[{r['ref']}] {r['english']}" for r in rows if r["english"])
        with client.messages.stream(
            model=MODEL, max_tokens=32000,
            thinking={"type": "adaptive"},
            output_config={"effort": "high", "format": {"type": "json_schema", "schema": SCHEMA}},
            messages=[{"role": "user", "content": PROMPT.format(span=span, work=work, rows=text)}],
        ) as stream:
            msg = stream.get_final_message()
        if msg.stop_reason != "end_turn":
            sys.exit(f"{work}: stop_reason {msg.stop_reason}")
        sheet = json.loads(next(b.text for b in msg.content if b.type == "text"))
        sheet["_usage"] = {"input": msg.usage.input_tokens, "output": msg.usage.output_tokens}
        (OUT / f"{work}.cast.json").write_text(json.dumps(sheet, ensure_ascii=False, indent=1))
        print(work, len(sheet["cast"]), "speakers,", len(sheet["scenes"]), "scenes,", sheet["_usage"])


if __name__ == "__main__":
    main(sys.argv[1:])
