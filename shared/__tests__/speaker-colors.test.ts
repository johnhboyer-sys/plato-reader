import { describe, expect, it } from 'vitest';
import { assignSpeakerSlots, spkHash, SPK_PALETTE_N } from '../lib/speaker-colors';

describe('spkHash', () => {
  it('is deterministic and non-negative', () => {
    expect(spkHash('Soc.')).toBe(spkHash('Soc.'));
    expect(spkHash('Callicles')).toBeGreaterThanOrEqual(0);
  });
  it('distinguishes different keys', () => {
    expect(spkHash('Soc.')).not.toBe(spkHash('Call.'));
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
