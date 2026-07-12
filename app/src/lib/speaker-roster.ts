// Build-time speaker roster for a work: the whole-work display order that both
// the reader (ReaderShell.astro) and the landing cast list (Landing.astro) feed
// to assignSpeakerSlots, so a speaker gets the SAME colour in the cast list and
// in every book of the text. Assigning per-book instead would let a later
// book's collision probe diverge from the whole-work assignment.
//
// Memoized per work: a multi-book work renders one reader page per book, and
// they must not each re-read every book file.
import { readFileSync } from 'node:fs';
import { collectDisplayOrder } from '@shared/lib/speaker-colors';

const cache = new Map<string, string[]>();

export function speakerRoster(workId: string, books: number): string[] {
  const hit = cache.get(workId);
  if (hit) return hit;
  const flows: unknown[] = [];
  for (let b = 1; b <= books; b++) {
    try {
      const bd = JSON.parse(
        readFileSync(`public/data/${workId}/book-${String(b).padStart(2, '0')}.json`, 'utf-8'),
      );
      flows.push(bd.turnFlow);
    } catch { /* a book file may be absent on a partial build */ }
  }
  const roster = collectDisplayOrder(flows as Parameters<typeof collectDisplayOrder>[0]);
  cache.set(workId, roster);
  return roster;
}
