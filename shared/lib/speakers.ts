// Speaker-turn rendering model for Stephanus dialogues (Plato). The pipeline
// emits, per Greek segment, a `speakers` array of turn events — {line, offset,
// label} — where `offset` is the char position in that line's rejoined text at
// which the interlocutor's speech begins, and `label` is the siglum ("ΕΥΘ.",
// "ΣΩ.") or the dialectic dash ("—"). Crucially, the label text itself is NOT
// present in the line text: it is rendered as a separate inline lead-in span so
// the clickable Greek tokens keep their exact char offsets (the word popup and
// every offset walker must see an unshifted token stream).
//
// This module owns the position math: given a line's verbatim text, its tokens,
// and the events that belong to that line, it produces an ordered list of
// render parts — plain text gaps, clickable tokens, and speaker lead-ins spliced
// in at each turn boundary — WITHOUT mutating the line text. It generalizes the
// reader's old `lineParts` (a text→tokens splitter): with no events it returns
// exactly the same token/gap sequence, so non-stephanus works are byte-identical.

import type { Token, GreekLine, TurnPair, EnglishTurn } from './data';

// A single speaker-turn event, as emitted in a segment's `speakers` array.
export interface SpeakerEvent {
  line: number;    // the Greek line `n` the turn begins on
  offset: number;  // char offset in that line's text where the speech begins
  label: string;   // the interlocutor siglum ("ΕΥΘ.") or the dialectic dash "—"
}

// One render part for a Greek line: a verbatim text gap (sigla / punctuation),
// a clickable token, or a speaker lead-in label inserted at a turn boundary.
export type LineRenderPart =
  | { kind: 'text'; text: string }
  | { kind: 'token'; text: string; tok: Token }
  | { kind: 'speaker'; label: string; dash: boolean };

// The dialectic dash ("—", used e.g. in Parmenides for unattributed turns)
// renders as a plain em-dash lead-in, not a small-caps siglum.
const DASH = '—';

// Build the render parts for a Greek line. `text` is the line's verbatim text
// (with OCT sigla and punctuation); `tokens` are its clickable words; `events`
// are the speaker turns that begin on this line (already filtered to it).
//
// The token/gap split is identical to the reader's historical `lineParts`: each
// token is located in `text` from a moving pointer, and the verbatim spans
// between tokens become plain-text parts. Speaker lead-ins are then spliced in
// at their char offsets — at a token boundary they sit immediately before the
// token; inside a verbatim gap the gap is split around them. The line text is
// never altered, so token char-offsets never move.
export function lineRenderParts(
  text: string,
  tokens: readonly Token[],
  events: readonly SpeakerEvent[] = [],
): LineRenderPart[] {
  // Atoms: the token/gap sequence, each tagged with its [start, end) char span.
  type Atom = { part: LineRenderPart; start: number; end: number };
  const atoms: Atom[] = [];
  let ptr = 0;
  for (const tok of tokens) {
    const i = text.indexOf(tok.t, ptr);
    if (i < 0) {
      // Shouldn't happen; keep the word clickable as a zero-width atom so a
      // stray speaker offset can't attach to a phantom range.
      atoms.push({ part: { kind: 'token', text: tok.t, tok }, start: ptr, end: ptr });
      continue;
    }
    if (i > ptr) atoms.push({ part: { kind: 'text', text: text.slice(ptr, i) }, start: ptr, end: i });
    atoms.push({ part: { kind: 'token', text: tok.t, tok }, start: i, end: i + tok.t.length });
    ptr = i + tok.t.length;
  }
  if (ptr < text.length) atoms.push({ part: { kind: 'text', text: text.slice(ptr) }, start: ptr, end: text.length });

  if (events.length === 0) return atoms.map((a) => a.part);

  const evs = [...events].sort((a, b) => a.offset - b.offset);
  const out: LineRenderPart[] = [];
  let ei = 0;
  const pushSpeaker = (e: SpeakerEvent) =>
    out.push({ kind: 'speaker', label: e.label, dash: e.label === DASH });

  for (const a of atoms) {
    // Any events landing at or before this atom's start lead it in.
    while (ei < evs.length && evs[ei].offset <= a.start) { pushSpeaker(evs[ei]); ei += 1; }
    // An event falling strictly inside a verbatim gap splits the gap around it;
    // tokens are never split (an interior offset attaches before the next atom).
    if (a.part.kind === 'text' && ei < evs.length && evs[ei].offset < a.end) {
      let cur = a.start;
      while (ei < evs.length && evs[ei].offset < a.end) {
        const off = evs[ei].offset;
        if (off > cur) out.push({ kind: 'text', text: text.slice(cur, off) });
        pushSpeaker(evs[ei]);
        ei += 1;
        cur = off;
      }
      if (cur < a.end) out.push({ kind: 'text', text: text.slice(cur, a.end) });
    } else {
      out.push(a.part);
    }
  }
  // Trailing events (offset at/after the line end) close out the line.
  while (ei < evs.length) { pushSpeaker(evs[ei]); ei += 1; }
  return out;
}

// ── Turn-paired row model (Stephanus dialogues) ─────────────────────────────
// For a segment whose Greek and English turn sequences reconciled (the pipeline
// emitted `turnPairs`), the reader lays each speaker's turn out as a ROW: the
// Greek cell holds that turn's Greek — from where it begins to where the next
// turn begins, possibly spanning or splitting lines — beside the English cell
// holding the same turn's prose with its small-caps lead-in. `buildTurnRows` is
// a pure function of the segment's data (Greek lines + speaker events + English
// text + turnPairs), so it can be unit-tested independently of the reader.

// One Greek line (or a slice of one) inside a turn row. `cont` marks a partial
// tail of a line already opened in an earlier row (its number/DOM id is not
// repeated — the reader emits an `-c` id instead, as it does for chapter splits).
export interface TurnRowLine {
  n: number;
  cont: boolean;
  parts: LineRenderPart[];
}

// One row of a turn-paired dialogue segment.
export interface TurnRow {
  // The leading continuation row (Greek/English that precede the segment's first
  // turn — the tail of a speech begun in an earlier section): no lead-in.
  lead: boolean;
  // The English speaker lead-in as printed ("Soc."); null for an unattributed
  // dash turn, which the reader shows as an em-dash to mirror the Greek.
  display: string | null;
  greek: TurnRowLine[];
  english: string;
}

// The Greek render-lines covering the span [from, to) across a segment's lines,
// where a bound is (line number, char offset in that line's text). Tokens whose
// start falls in the span stay clickable (offsets rebased to the slice); the
// speaker events in the span are spliced in as lead-ins. A line opened at offset
// 0 keeps its number/id; a partial tail (offset > 0) is marked `cont`.
function sliceGreek(
  lines: readonly GreekLine[],
  events: readonly SpeakerEvent[],
  from: { line: number; offset: number },
  to: { line: number; offset: number },
): TurnRowLine[] {
  const iFrom = lines.findIndex((l) => l.n === from.line);
  const iTo = lines.findIndex((l) => l.n === to.line);
  if (iFrom < 0 || iTo < 0) return [];
  const out: TurnRowLine[] = [];
  for (let i = iFrom; i <= iTo; i += 1) {
    const L = lines[i];
    const s = i === iFrom ? from.offset : 0;
    const e = i === iTo ? to.offset : L.text.length;
    if (s >= e) continue; // empty slice (a boundary landing on a line edge)
    const text = L.text.slice(s, e);
    // Keep the ORIGINAL Token objects (lineRenderParts locates each by its
    // surface text within the slice, never by `o`), so the word popup's
    // identity check and Beta Code keys survive the split unchanged.
    const tokens: Token[] = L.tokens.filter((t) => t.o >= s && t.o < e);
    const evs = events
      .filter((ev) => ev.line === L.n && ev.offset >= s && ev.offset < e)
      .map((ev) => ({ ...ev, offset: ev.offset - s }));
    out.push({ n: L.n, cont: s > 0, parts: lineRenderParts(text, tokens, evs) });
  }
  return out;
}

export function buildTurnRows(
  greek: readonly GreekLine[],
  events: readonly SpeakerEvent[],
  englishText: string,
  pairs: readonly TurnPair[],
): TurnRow[] {
  if (!greek.length || !pairs.length) return [];
  const first = { line: greek[0].n, offset: 0 };
  const lastLine = greek[greek.length - 1];
  const end = { line: lastLine.n, offset: lastLine.text.length };
  const gBound = (i: number) =>
    i < pairs.length ? { line: pairs[i].g.line, offset: pairs[i].g.offset } : end;
  const eBound = (i: number) =>
    i < pairs.length ? pairs[i].e.offset : englishText.length;

  const rows: TurnRow[] = [];
  // Leading continuation row: content before the segment's first turn.
  const leadGreek = sliceGreek(greek, events, first, gBound(0));
  const leadEng = englishText.slice(0, eBound(0)).trim();
  if (leadGreek.length || leadEng) {
    rows.push({ lead: true, display: null, greek: leadGreek, english: leadEng });
  }
  for (let i = 0; i < pairs.length; i += 1) {
    rows.push({
      lead: false,
      display: pairs[i].display,
      greek: sliceGreek(greek, events, gBound(i), gBound(i + 1)),
      english: englishText.slice(eBound(i), eBound(i + 1)).trim(),
    });
  }
  return rows;
}

// ── English turn blocks (unpaired dialogue / narrated fallback) ─────────────
// A dialogue segment whose turns did NOT reconcile with the Greek (no
// turnPairs), and a narrated work's chunk that carries English <said> turns
// with no Greek events at all, still owe the reader per-turn structure: print
// editions set each speech as its own paragraph with its lead-in. This helper
// slices the chunk prose at the turn offsets into a stack of blocks — never an
// inline splice, so a label can never end up glued to the tail of the previous
// sentence ("…as I have.SOCRATES. Our…").

// One block of a fallback English stack. `lead` marks the unlabeled leading
// block (text before the first turn — the tail of a speech begun in an earlier
// section); `display` is the printed lead-in, null for an unattributed turn
// (rendered as an em-dash, mirroring the Greek dash).
export interface EnglishTurnBlock {
  lead: boolean;
  display: string | null;
  text: string;
}

export function buildEnglishTurnBlocks(
  text: string,
  turns: readonly EnglishTurn[],
): EnglishTurnBlock[] {
  if (!turns.length) return [{ lead: true, display: null, text }];
  const blocks: EnglishTurnBlock[] = [];
  const lead = text.slice(0, turns[0].offset).trim();
  if (lead) blocks.push({ lead: true, display: null, text: lead });
  for (let i = 0; i < turns.length; i += 1) {
    const end = i + 1 < turns.length ? turns[i + 1].offset : text.length;
    const t = text.slice(turns[i].offset, end).trim();
    // An empty UNLABELED slice (two adjacent boundaries with nothing between,
    // e.g. a reported turn whose text the walker filed elsewhere) would render
    // as a bare em-dash paragraph — drop it. A labeled turn keeps its block
    // even when empty, so the attribution itself is never lost.
    if (!t && turns[i].display == null) continue;
    blocks.push({ lead: false, display: turns[i].display, text: t });
  }
  return blocks;
}
