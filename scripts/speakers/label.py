"""Step B: label voice segments with Opus through the Message Batches API.

  label.py submit Charmides Lysis Republic   # builds both passes, one batch
  label.py fetch                             # waits, saves results + usage

Pass 1 windows start at the work's first row; pass 2 is shifted by half a
window, so every row is read twice from a different starting point.
Run with: env -u ANTHROPIC_API_KEY uv run --no-project --with anthropic python ...
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / "build" / os.environ.get("SPEAKERS_RUN", "speakers-pilot")
MODEL = "claude-opus-5-5"
WINDOW = 8000      # Greek characters per window (~8k tokens)
CONTEXT = 2500     # Greek characters of preceding rows shown as context

INSTRUCTIONS = """You are helping prepare a scholarly reader of Plato's complete works. The Greek is Burnet's Oxford text (as in the TLG); the English is a Loeb translation, given as an aid. In narrated dialogues the Greek prints no speaker names. Your task is to mark, in the Greek, where each voice begins and whose voice it is.

Work: {work}
Frame: {frame}
Narrator: {narrator}

Cast (use only these ids):
{cast}

Scene map (a guide; it can be incomplete):
{scenes}

INPUT
A run of rows, each with an id, a Stephanus reference, its Greek, and its English. Rows inside <context> are there only so you can follow the conversation: do not label them. Label every row inside <window>, in order.
In the Greek, ¶ marks a paragraph break in Burnet's edition. A new paragraph almost always means a new speaker, but speakers also change inside a paragraph and in mid-line, where short exchanges run on ("Ἴσως, ἔφη. Ἵνα τοίνυν ..."). A row can also open in the middle of a speech carried over from the row before; then its first segment continues that speaker.

OUTPUT
A list of segments. A segment starts where a voice starts and runs to the start of the next segment, or to the end of the row.
- row: the row id.
- words: the first two to four Greek words of the segment, copied exactly as printed, enough to find the spot uniquely within the row. The first segment of every row starts at the row's first word.
- speaker: whose words these are.
- kind:
  speech = a character speaking in the scene in direct speech, including the narrator speaking as a character ("Οὐ κακῶς, ἦν δ᾽ ἐγώ, ...").
  narration = the narrator telling his listener what happened: scene, actions, gestures, and indirect report of what someone said (εἶπεν ὅτι ..., accusative and infinitive). The speaker is whoever narrates at that level.
  reported = direct speech of a real voice quoted inside a character's speech (Cephalus quoting Sophocles, Socrates quoting Pindar or Diotima). The speaker is the quoted voice; within is the character quoting it.
  imagined = words a character puts in the mouth of a hypothetical or invented speaker ("if someone asked me ...", "εἴποι ἄν τις", "εἰ ἔροιο ...", the Muses speaking in tragic style). The speaker is the character who imagines them, not the imagined voice; within is "none".
- within: the quoting character when kind is reported, otherwise "none".
- doubt: true only when the Greek and the context leave the speaker genuinely unsettled.
- cue: a few words on what settled it, quoting the Greek cue when there is one (e.g. "ἔφη; ὦ Σώκρατες", "answers the question before", "alternation").

RULES
- A short inquit (ἔφη, ἔφην, ἦν δ᾽ ἐγώ, ἦ δ᾽ ὅς, εἶπεν) set inside or after a speech belongs to that speech: do not start a segment at it. Start a narration segment only where the narrator tells something beyond the inquit, a clause or more.
- Where narration leads into speech ("καὶ ἐγὼ εἶπον· Ὦ παῖ ..."), split: narration up to the speech, then a speech segment at the speech's first word.
- A bare name that introduces the next speaker (Καὶ ὁ Γλαύκων, / Καὶ ὁ Ἀδείμαντος, / Καὶ ὁ Χαρμίδης,) belongs to that speaker's speech: start the speech segment at the name, not after it. Only a clause with its own verb (Καὶ ἐγὼ ἀκούσας εἶπον·) is narration.
- A verb of saying with no quoted words ("Οὐκ ἔφη." = he denied it; "Συνέφη." / "Συνεφάτην." / "ὡμολόγει." = he agreed) is narration by the narrator, not speech.
- A name given in the inquit settles the speaker: ἔφη ὁ Κριτίας; "ἐγώ, ὁ Πολέμαρχος" is Polemarchus speaking of himself.
- A reported or imagined segment starts at the first word of the quoted words (after any lead-in such as καὶ ὅς, ὅτι, or εἶπεν·, which stay with the reporter) and ends where the reporter speaks again in his own voice, including where the quotation slides back into indirect report (infinitive, ὅτι with optative).
- A dual or plural verb of a shared answer (ἐφάτην, ἔφασαν) takes the joint cast id for those speakers (e.g. lysis+menexenus), never one of them.
- A vocative names the person addressed, never the speaker.
- Use "unknown" only when no cast member can be the speaker. Every quoted poet is in the cast; use that id."""


def schema(cast_ids: list[str], row_ids: list[str]) -> dict:
    return {
        "type": "object", "additionalProperties": False, "required": ["segments"],
        "properties": {"segments": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["row", "words", "speaker", "kind", "within", "doubt", "cue"],
            "properties": {
                "row": {"type": "string", "enum": row_ids},
                "words": {"type": "string"},
                "speaker": {"type": "string", "enum": cast_ids + ["unknown"]},
                "kind": {"type": "string", "enum": ["speech", "narration", "reported", "imagined"]},
                "within": {"type": "string", "enum": cast_ids + ["none"]},
                "doubt": {"type": "boolean"},
                "cue": {"type": "string"},
            }}}},
    }


def windows(rows: list[dict], first: int) -> list[tuple[int, int]]:
    """[start, end) row ranges of about WINDOW Greek chars; the first one ends near `first` chars."""
    out, start, size, target = [], 0, 0, first
    for i, r in enumerate(rows):
        size += len(r["greek"])
        if size >= target and i + 1 < len(rows):
            out.append((start, i + 1))
            start, size, target = i + 1, 0, WINDOW
    out.append((start, len(rows)))
    if len(out) > 1 and sum(len(r["greek"]) for r in rows[out[-1][0]:]) < WINDOW / 3:
        out[-2:] = [(out[-2][0], len(rows))]   # fold a short tail into the window before
    return out


def fmt(r: dict) -> str:
    return (f'<row id="{r["id"]}" ref="{r["ref"]}">\n<greek>{r["greek"]}</greek>\n'
            f'<english>{r["english"]}</english>\n</row>')


def requests_for(work: str) -> tuple[list[dict], dict]:
    rows = json.loads((OUT / f"{work}.rows.json").read_text())
    sheet = json.loads((OUT / f"{work}.cast.json").read_text())
    cast_ids = [c["id"] for c in sheet["cast"]]
    system = INSTRUCTIONS.format(
        work=work, frame=sheet["frame"], narrator=sheet["narrator"],
        cast="\n".join(f'- {c["id"]}: {c["english"]} ({c["greek_nominative"]}, voc. {c["greek_vocative"]}); {c["role"]}'
                       for c in sheet["cast"]),
        scenes="\n".join(f'- {s["start"]}–{s["end"]}: {", ".join(s["speakers"])}. {s["note"]}'
                         for s in sheet["scenes"]))
    reqs, meta = [], {}
    for p, first in ((1, WINDOW), (2, WINDOW // 2)):
        for k, (a, b) in enumerate(windows(rows, first)):
            ctx, size = [], 0
            for r in reversed(rows[:a]):
                if size >= CONTEXT:
                    break
                ctx.insert(0, r)
                size += len(r["greek"])
            body = ""
            if ctx:
                body += "<context>\n" + "\n".join(fmt(r) for r in ctx) + "\n</context>\n"
            body += "<window>\n" + "\n".join(fmt(r) for r in rows[a:b]) + "\n</window>"
            cid = f"p{p}-{work[:3]}-{k:02d}"
            meta[cid] = {"work": work, "pass": p, "rows": [r["id"] for r in rows[a:b]]}
            reqs.append({"custom_id": cid, "params": {
                "model": MODEL, "max_tokens": 48000,
                "thinking": {"type": "adaptive"},
                "output_config": {"effort": "high", "format": {
                    "type": "json_schema", "schema": schema(cast_ids, meta[cid]["rows"])}},
                "system": [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
                "messages": [{"role": "user", "content": body}],
            }})
    return reqs, meta


def submit(works: list[str]) -> None:
    import anthropic
    reqs, meta = [], {}
    for w in works:
        r, m = requests_for(w)
        reqs += r
        meta.update(m)
        print(w, sum(1 for c in m if c.startswith("p1")), "+", sum(1 for c in m if c.startswith("p2")), "windows")
    batch = anthropic.Anthropic().messages.batches.create(requests=reqs)
    (OUT / "batch.json").write_text(json.dumps({"id": batch.id, "meta": meta}, indent=1))
    print("batch", batch.id, batch.processing_status)


def fetch() -> None:
    import anthropic
    client = anthropic.Anthropic()
    info = json.loads((OUT / "batch.json").read_text())
    while (b := client.messages.batches.retrieve(info["id"])).processing_status != "ended":
        print(time.strftime("%H:%M"), b.request_counts, flush=True)
        time.sleep(60)
    res_dir = OUT / "results"
    res_dir.mkdir(exist_ok=True)
    usage = {"input": 0, "cache_read": 0, "cache_write": 0, "output": 0}
    for r in client.messages.batches.results(info["id"]):
        if r.result.type != "succeeded":
            print(r.custom_id, r.result.type, getattr(r.result, "error", ""))
            continue
        msg = r.result.message
        u = msg.usage
        usage["input"] += u.input_tokens
        usage["cache_read"] += u.cache_read_input_tokens or 0
        usage["cache_write"] += u.cache_creation_input_tokens or 0
        usage["output"] += u.output_tokens
        text = next((x.text for x in msg.content if x.type == "text"), "")
        out = {"stop": msg.stop_reason, "usage": u.model_dump(), "data": json.loads(text) if msg.stop_reason == "end_turn" else None}
        (res_dir / f"{r.custom_id}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
        if msg.stop_reason != "end_turn":
            print(r.custom_id, "stop", msg.stop_reason)
    # batch prices for claude-opus-5-5: half of $4 in / $20 out; cache read $0.20 → $0.10, write 1.25x input
    cost = (usage["input"] * 2 + usage["cache_read"] * 0.10 + usage["cache_write"] * 2.5 + usage["output"] * 10) / 1e6
    usage["cost_usd"] = round(cost, 2)
    (OUT / "usage.json").write_text(json.dumps(usage, indent=1))
    print(usage)


if __name__ == "__main__":
    {"submit": lambda: submit(sys.argv[2:]), "fetch": fetch}[sys.argv[1]]()
