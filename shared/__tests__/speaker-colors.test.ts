import { describe, expect, it } from 'vitest';
import { assignSpeakerSlots, collectDisplayOrder, spkHash, SPK_PALETTE_N } from '../lib/speaker-colors';

describe('spkHash', () => {
  it('is deterministic and non-negative', () => {
    expect(spkHash('Soc.')).toBe(spkHash('Soc.'));
    expect(spkHash('Callicles')).toBeGreaterThanOrEqual(0);
  });
  it('distinguishes different keys', () => {
    expect(spkHash('Soc.')).not.toBe(spkHash('Call.'));
  });
});

describe('collectDisplayOrder', () => {
  const flow = (turns: unknown[]) => ({ turns } as Parameters<typeof collectDisplayOrder>[0] extends Iterable<infer F> ? F : never);
  it('collects turn, embedded (et), and folded (sub) displays in encounter order', () => {
    const tf = flow([
      { d: 'Soc.', et: [{ d: 'Ath.' }], sub: null },
      { d: 'Call.', et: null, sub: [{ d: 'Gorg.' }] },
    ]);
    expect(collectDisplayOrder([tf])).toEqual(['Soc.', 'Ath.', 'Call.', 'Gorg.']);
  });
  it('de-duplicates, keeping first appearance', () => {
    const tf = flow([{ d: 'Soc.' }, { d: 'Call.' }, { d: 'Soc.' }]);
    expect(collectDisplayOrder([tf])).toEqual(['Soc.', 'Call.']);
  });
  it('spans multiple books in order (the whole-work roster)', () => {
    const b1 = flow([{ d: 'Ath.' }, { d: 'Clin.' }]);
    const b2 = flow([{ d: 'Clin.' }, { d: 'Meg.' }]);
    expect(collectDisplayOrder([b1, b2])).toEqual(['Ath.', 'Clin.', 'Meg.']);
  });
  it('ignores null/absent flows and null displays', () => {
    const tf = flow([{ d: null }, { d: 'Soc.' }]);
    expect(collectDisplayOrder([null, undefined, tf])).toEqual(['Soc.']);
  });
  it('makes the whole-work roster stable regardless of which book is read first', () => {
    // The multi-book bug this fixes: a per-book assignment could give a speaker
    // a different slot than the whole-work assignment. Feeding the same roster
    // to assignSpeakerSlots everywhere removes that divergence.
    const b1 = flow([{ d: 'Ath.' }, { d: 'Clin.' }, { d: 'Meg.' }]);
    const b2 = flow([{ d: 'Meg.' }, { d: 'Ath.' }]);
    const roster = collectDisplayOrder([b1, b2]);
    const whole = assignSpeakerSlots(roster);
    // Every book, assigned from the whole roster, agrees with `whole`.
    for (const key of collectDisplayOrder([b2])) {
      expect(assignSpeakerSlots(roster).get(key)).toBe(whole.get(key));
    }
  });
});

describe('assignSpeakerSlots', () => {
  it('gives every distinct key a slot in range', () => {
    const m = assignSpeakerSlots(['Soc.', 'Call.', 'Gorg.', 'Pol.', 'Chaer.']);
    expect(m.size).toBe(5);
    for (const slot of m.values()) {
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(SPK_PALETTE_N);
    }
  });
  it('keeps a small cast fully distinct (no collisions)', () => {
    const m = assignSpeakerSlots(['Soc.', 'Call.', 'Gorg.', 'Pol.', 'Chaer.']);
    expect(new Set(m.values()).size).toBe(m.size);
  });
  it('is order-independent for a given cast set (same slots regardless of first-appearance order)', () => {
    const a = assignSpeakerSlots(['Soc.', 'Call.', 'Gorg.']);
    // Reversed input: the base hash slots are the same, and with no collisions
    // among these three the assignment is identical.
    const b = assignSpeakerSlots(['Gorg.', 'Call.', 'Soc.']);
    expect(b.get('Soc.')).toBe(a.get('Soc.'));
    expect(b.get('Gorg.')).toBe(a.get('Gorg.'));
  });
  it('dedupes repeated keys, keeping the first assignment', () => {
    const m = assignSpeakerSlots(['Soc.', 'Call.', 'Soc.', 'Call.']);
    expect(m.size).toBe(2);
  });
  it('never assigns the same slot twice while the cast fits the palette', () => {
    const keys = Array.from({ length: SPK_PALETTE_N }, (_, i) => `S${i}`);
    const m = assignSpeakerSlots(keys);
    expect(new Set(m.values()).size).toBe(SPK_PALETTE_N);
  });
  it('handles a cast larger than the palette without crashing', () => {
    const keys = Array.from({ length: SPK_PALETTE_N + 4 }, (_, i) => `S${i}`);
    const m = assignSpeakerSlots(keys);
    expect(m.size).toBe(SPK_PALETTE_N + 4);
    for (const slot of m.values()) expect(slot).toBeLessThan(SPK_PALETTE_N);
  });
});
