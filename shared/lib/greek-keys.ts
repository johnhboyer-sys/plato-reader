// The search page's on-screen Greek keyboard: what its keys are, and the edit
// each makes to the Greek box. A key types at the caret; a mark joins the
// letter before the caret, composed as the Beta Code box composes it
// (liveGreek); backspace takes a whole letter with its marks.

import { liveGreek, LIVE_RANK } from './betacode';

export const GREEK_KEYS = [...'αβγδεζηθικλμνξοπρστυφχψως'];

export const GREEK_MARKS: { mark: string; name: string }[] = [
  { mark: '̓', name: 'smooth breathing' },
  { mark: '̔', name: 'rough breathing' },
  { mark: '́', name: 'acute' },
  { mark: '̀', name: 'grave' },
  { mark: '͂', name: 'circumflex' },
  { mark: '̈', name: 'diaeresis' },
  { mark: 'ͅ', name: 'iota subscript' },
];

export interface KeyEdit { value: string; caret: number }

export function insertText(value: string, start: number, end: number, text: string): KeyEdit {
  return { value: value.slice(0, start) + text + value.slice(end), caret: start + text.length };
}

const isMark = (ch: string) => /\p{M}/u.test(ch);
// Where the letter before `caret` begins, its marks included.
function letterStart(value: string, caret: number): number {
  let i = caret;
  while (i > 0 && isMark(value[i - 1])) i--;
  return i > 0 ? i - 1 : 0;
}

/** The mark joined to the Greek letter before the caret; one of the same kind
 * (breathing or diaeresis, accent, subscript) is replaced, not stacked. Null
 * when no Greek letter stands there. */
export function addMark(value: string, caret: number, mark: string): KeyEdit | null {
  if (caret <= 0) return null;
  const start = letterStart(value, caret);
  const [base, ...marks] = value.slice(start, caret).normalize('NFD');
  if (!base || !/(?=\p{L})\p{Script=Greek}/u.test(base) || /[σςΣ]/.test(base)) return null;
  const kept = marks.filter((m) => LIVE_RANK[m] !== LIVE_RANK[mark]);
  const letter = liveGreek(base + [...kept, mark].join(''));
  return { value: value.slice(0, start) + letter + value.slice(caret), caret: start + letter.length };
}

/** Backspace: the selection, or the letter before the caret with its marks. */
export function deleteBack(value: string, start: number, end: number): KeyEdit {
  if (end > start) return { value: value.slice(0, start) + value.slice(end), caret: start };
  if (start <= 0) return { value, caret: 0 };
  const from = letterStart(value, start);
  return { value: value.slice(0, from) + value.slice(start), caret: from };
}
