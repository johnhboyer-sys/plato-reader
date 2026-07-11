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

import type { Token, GreekLine, Segment, TurnFlow, EnglishTurn } from './data';

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

// ── Turn-flow row model (Stephanus dialogues) ────────────────────────────────
// John's Tier-0 requirement: each speaker's statement is the aligned ROW — the
// first Greek line of a turn sits level with the first English line of its
// translation, for the WHOLE BOOK (the pipeline pairs turns globally, so
// Stephanus section boundaries never break a row). Sections dissolve into the
// continuous flow; each section's first Greek line carries a gutter TICK (the
// column token, e.g. "2b") which is also the `col-{token}` citation anchor.
// `buildFlowRows` is a pure function of (segments, turnFlow) so it can be
// unit-tested independently of the reader.

// One Greek line (or a slice of one) inside a flow row. `col` + `n` identify
// the line (`L{col}-{n}` DOM id); `cont` marks a partial tail of a line opened
// in an earlier row (no repeated id — the reader emits `-c`); `tick` carries
// the section token when this line opens a Stephanus section (the reader
// floats it in the gutter and anchors `col-{tick}` on it).
export interface FlowLine {
  col: string;
  n: number;
  cont: boolean;
  tick: string | null;
  parts: LineRenderPart[];
}

// One row of the turn flow: a paired turn (Greek beside English), a one-sided
// residual (greek/english empty on the other side), or the leading
// continuation row before the first turn.
export interface FlowRow {
  lead: boolean;
  paired: boolean;
  // The printed English lead-in ("Soc."); null for an unattributed dash turn
  // (rendered as an em-dash) and for Greek-only residuals (the Greek cell
  // shows its own siglum inline).
  display: string | null;
  speaker: string | null;
  greek: FlowLine[];
  english: string | null;
  // Section tokens whose ticks fall inside this row's Greek — the reader
  // renders row-level gutter markers from these in English-only view (where
  // the Greek cells, and so the exact tick lines, are hidden).
  ticks: string[];
}

// The whole book's Greek lines in document order, each carrying its column and
// (for the first line of each section) its tick token.
interface BookLine {
  col: string;
  tick: string | null;
  line: GreekLine;
  events: SpeakerEvent[];
}

function bookLines(segments: readonly Segment[]): BookLine[] {
  const out: BookLine[] = [];
  for (const seg of segments) {
    seg.greek.forEach((line, i) => {
      out.push({
        col: seg.column,
        tick: i === 0 ? seg.column : null,
        line,
        events: (seg.speakers ?? []).filter((s) => s.line === line.n),
      });
    });
  }
  return out;
}

// The Greek render-lines covering [from, to) over the book's line list, where a
// bound is a line index + char offset. Tokens whose start falls in the slice
// stay clickable (ORIGINAL Token objects — lineRenderParts locates each by its
// surface text, never by `o`, so popup identity and Beta Code keys survive);
// speaker events in the slice are spliced in as lead-ins. A line opened at
// offset 0 keeps its id and its section tick; a partial tail is `cont`.
function sliceBook(
  lines: readonly BookLine[],
  from: { i: number; o: number },
  to: { i: number; o: number },
): FlowLine[] {
  const out: FlowLine[] = [];
  for (let i = from.i; i <= to.i && i < lines.length; i += 1) {
    const B = lines[i];
    const s = i === from.i ? from.o : 0;
    const e = i === to.i ? to.o : B.line.text.length;
    if (s >= e) continue; // empty slice (a boundary on a line edge)
    const text = B.line.text.slice(s, e);
    const tokens: Token[] = B.line.tokens.filter((t) => t.o >= s && t.o < e);
    const evs = B.events
      .filter((ev) => ev.offset >= s && ev.offset < e)
      .map((ev) => ({ ...ev, offset: ev.offset - s }));
    out.push({
      col: B.col,
      n: B.line.n,
      cont: s > 0,
      tick: s === 0 ? B.tick : null,
      parts: lineRenderParts(text, tokens, evs),
    });
  }
  return out;
}

export function buildFlowRows(
  segments: readonly Segment[],
  flow: TurnFlow,
): FlowRow[] {
  const lines = bookLines(segments);
  if (!lines.length || !flow.turns.length) return [];
  // Line index of each (column, n) ref. Line numbers restart per section, so
  // the key needs both.
  const idx = new Map<string, number>();
  lines.forEach((b, i) => idx.set(`${b.col} ${b.line.n}`, i));
  // Bound of each Greek-bearing turn; null for English-only residuals and for
  // an unresolvable ref (which then contributes no Greek slice).
  const bounds: ({ i: number; o: number } | null)[] = flow.turns.map((t) => {
    if (!t.g) return null;
    const i = idx.get(`${t.g.c} ${t.g.n}`);
    return i === undefined ? null : { i, o: t.g.o };
  });
  const end = { i: lines.length - 1, o: lines[lines.length - 1].line.text.length };
  // For each Greek-bearing turn, its slice runs to the NEXT Greek-bearing
  // turn's start (residual English turns in between don't cut the Greek).
  const nextG: ({ i: number; o: number } | null)[] = new Array(flow.turns.length).fill(null);
  let nxt: { i: number; o: number } = end;
  for (let ti = flow.turns.length - 1; ti >= 0; ti -= 1) {
    nextG[ti] = nxt;
    if (bounds[ti]) nxt = bounds[ti]!;
  }
  const ticksOf = (greek: FlowLine[]) =>
    greek.filter((l) => l.tick !== null).map((l) => l.tick!);

  const rows: FlowRow[] = [];
  // Leading row: Greek before the first Greek turn + English before the first
  // English turn (both are tails of speech begun before this book/section span).
  const firstG = bounds.find((b) => b !== null) ?? end;
  const leadGreek = sliceBook(lines, { i: 0, o: 0 }, firstG);
  if (leadGreek.length || flow.leadE) {
    rows.push({
      lead: true, paired: false, display: null, speaker: null,
      greek: leadGreek, english: flow.leadE, ticks: ticksOf(leadGreek),
    });
  }
  flow.turns.forEach((t, ti) => {
    const greek = bounds[ti] ? sliceBook(lines, bounds[ti]!, nextG[ti]!) : [];
    rows.push({
      lead: false,
      paired: t.p,
      display: t.d,
      speaker: t.s,
      greek,
      english: t.e,
      ticks: ticksOf(greek),
    });
  });
  return rows;
}

// ── English turn blocks (narrated fallback) ─────────────────────────────────
// A narrated work's chunk that carries English <said> turns with no Greek
// events (Republic, Apology…) gets no turn flow, but its speeches still owe
// the reader per-turn structure: print editions set each speech as its own
// paragraph with its lead-in. This helper
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
