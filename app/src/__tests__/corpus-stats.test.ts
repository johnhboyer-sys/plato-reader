import { describe, expect, it } from 'vitest';
import { greekFold } from '../../../shared/lib/search';
import { keyness, lemmaStats, workVocabulary, type Vocabulary } from '../lib/corpus-stats';

// Real data from a full build: ψυχή's lemma page byWork (1,143 uses in 32 works,
// with Republic's and Laws' per-book counts) and every work's word count from
// public/data/lemmata/_words.json.
const psyche = [{"work": "Republic", "count": 225, "books": {"1": 10, "2": 14, "3": 30, "4": 25, "5": 4, "6": 20, "7": 34, "8": 14, "9": 28, "10": 46}}, {"work": "Laws", "count": 209, "books": {"1": 11, "2": 17, "3": 10, "4": 8, "5": 21, "6": 6, "7": 28, "8": 14, "9": 15, "10": 51, "11": 11, "12": 17}}, {"work": "Phaedo", "count": 138}, {"work": "Gorgias", "count": 72}, {"work": "Timaeus", "count": 67}, {"work": "Phaedrus", "count": 55}, {"work": "Philebus", "count": 48}, {"work": "Cratylus", "count": 36}, {"work": "Sophist", "count": 36}, {"work": "Theaetetus", "count": 35}, {"work": "Letters", "count": 28}, {"work": "Epinomis", "count": 27}, {"work": "Symposium", "count": 24}, {"work": "Alcibiades1", "count": 22}, {"work": "Meno", "count": 19}, {"work": "HippiasMinor", "count": 15}, {"work": "Protagoras", "count": 15}, {"work": "Statesman", "count": 13}, {"work": "Charmides", "count": 11}, {"work": "Euthydemus", "count": 8}, {"work": "Laches", "count": 6}, {"work": "Clitophon", "count": 5}, {"work": "Ion", "count": 5}, {"work": "Alcibiades2", "count": 4}, {"work": "Lysis", "count": 4}, {"work": "Apology", "count": 3}, {"work": "Lovers", "count": 3}, {"work": "Minos", "count": 3}, {"work": "Critias", "count": 2}, {"work": "HippiasMajor", "count": 2}, {"work": "Parmenides", "count": 2}, {"work": "Menexenus", "count": 1}].map((w) => ({ ...w, title: w.work }));
const words = {"Alcibiades1": {"words": 10270, "books": {"1": 10270}}, "Alcibiades2": {"words": 4179, "books": {"1": 4179}}, "Apology": {"words": 8741, "books": {"1": 8741}}, "Charmides": {"words": 8316, "books": {"1": 8316}}, "Clitophon": {"words": 1550, "books": {"1": 1550}}, "Cratylus": {"words": 18188, "books": {"1": 18188}}, "Critias": {"words": 4944, "books": {"1": 4944}}, "Crito": {"words": 4172, "books": {"1": 4172}}, "Epinomis": {"words": 6314, "books": {"1": 6314}}, "Euthydemus": {"words": 12475, "books": {"1": 12475}}, "Euthyphro": {"words": 5170, "books": {"1": 5170}}, "Gorgias": {"words": 26265, "books": {"1": 26265}}, "Hipparchus": {"words": 2239, "books": {"1": 2239}}, "HippiasMajor": {"words": 8449, "books": {"1": 8449}}, "HippiasMinor": {"words": 4185, "books": {"1": 4185}}, "Ion": {"words": 3845, "books": {"1": 3845}}, "Laches": {"words": 7681, "books": {"1": 7681}}, "Laws": {"words": 102925, "books": {"1": 8109, "2": 7160, "3": 8245, "4": 6335, "5": 7069, "6": 10911, "7": 12007, "8": 7382, "9": 9696, "10": 8414, "11": 8424, "12": 9173}}, "Letters": {"words": 16943, "books": {"1": 16943}}, "Lovers": {"words": 2393, "books": {"1": 2393}}, "Lysis": {"words": 6933, "books": {"1": 6933}}, "Menexenus": {"words": 4808, "books": {"1": 4808}}, "Meno": {"words": 9700, "books": {"1": 9700}}, "Minos": {"words": 2821, "books": {"1": 2821}}, "Parmenides": {"words": 15261, "books": {"1": 15261}}, "Phaedo": {"words": 22335, "books": {"1": 22335}}, "Phaedrus": {"words": 16600, "books": {"1": 16600}}, "Philebus": {"words": 17676, "books": {"1": 17676}}, "Protagoras": {"words": 17540, "books": {"1": 17540}}, "Republic": {"words": 88229, "books": {"1": 9448, "2": 8655, "3": 9997, "4": 8883, "5": 10210, "6": 8729, "7": 8585, "8": 8174, "9": 6858, "10": 8690}}, "Sophist": {"words": 16030, "books": {"1": 16030}}, "Statesman": {"words": 16968, "books": {"1": 16968}}, "Symposium": {"words": 17340, "books": {"1": 17340}}, "Theaetetus": {"words": 22511, "books": {"1": 22511}}, "Theages": {"words": 3454, "books": {"1": 3454}}, "Timaeus": {"words": 23652, "books": {"1": 23652}}};

describe('Lemma statistics', () => {
  const rows = lemmaStats(psyche, words);

  it('sums to the lemma\'s total count, by work and by book', () => {
    expect(rows.reduce((n, r) => n + r.count, 0)).toBe(1143);
    for (const r of rows.filter((r) => r.books)) {
      expect(r.books!.reduce((n, b) => n + b.count, 0)).toBe(r.count);
    }
    expect(rows.find((r) => r.work === 'Republic')!.books).toHaveLength(10);
    expect(rows.find((r) => r.work === 'Phaedo')!.books).toBeUndefined();
  });

  it('expects the corpus rate times the work\'s words', () => {
    const phaedo = rows.find((r) => r.work === 'Phaedo')!;
    // 1,143 uses in 561,102 words; Phaedo has 22,335 words and uses ψυχή 138 times.
    expect(phaedo.expected).toBeCloseTo((1143 / 561102) * 22335, 6);
    expect(phaedo.rate).toBeCloseTo(138 / 22.335, 6);
    expect(phaedo.ratio).toBeCloseTo(138 / phaedo.expected, 6);
    // Over every work, the expected counts are the lemma's total again.
    const all = lemmaStats(Object.keys(words).map((work) =>
      psyche.find((p) => p.work === work) ?? { work, title: work, count: 0 }), words);
    expect(all.reduce((n, r) => n + r.expected, 0)).toBeCloseTo(1143, 6);
  });
});

// ψυχή's forms in the Phaedo from build/vocabulary.json, beside the same
// forms' postings in the Phaedo's form index (search/greek_form.json, keyed
// on the accent-folded form): ψυχή, Ψυχή and ψυχῇ are one key there.
const vocab: Vocabulary = {
  words,
  lemmata: {
    'yu_xh/': {
      head: 'ψυχή', fold: 'yuxh', slug: 'psyche',
      byWork: {
        Phaedo: { ψυχή: 62, ψυχήν: 34, ψυχῆς: 14, ψυχαί: 11, ψυχῇ: 6, ψυχάς: 5, ψυχῶν: 3, ψυχαῖς: 2, Ψυχή: 1 },
        Republic: { ψυχῆς: 80 },
      },
    },
    'ke/bhs': { head: 'Κέβης', fold: 'kebhs', slug: 'kebes', byWork: { Phaedo: { Κέβης: 40 } } },
    'qrasu/maxos': { head: 'Θρασύμαχος', fold: 'qrasumaxos', byWork: { Republic: { Θρασύμαχος: 30 } } },
  },
};
const formIndex: Record<string, number> = { yuxh: 69, yuxhn: 34, yuxhs: 14, yuxai: 11, yuxas: 5, yuxwn: 3, yuxais: 2 };

describe('Vocabulary per work', () => {
  it('lists each lemma with its count and forms, agreeing with the form index', () => {
    const list = workVocabulary(vocab, 'Phaedo');
    expect(list.map((e) => [e.head, e.count])).toEqual([['ψυχή', 138], ['Κέβης', 40]]);
    const byFold: Record<string, number> = {};
    for (const [form, n] of list[0].forms) byFold[greekFold(form)] = (byFold[greekFold(form)] ?? 0) + n;
    expect(byFold).toEqual(formIndex);
  });

  it('finds the lemmata used most, least and only in a work', () => {
    const k = keyness(vocab, 'Phaedo');
    expect(k.only.map((e) => e.head)).toEqual(['Κέβης']);
    expect(k.over.map((r) => r.entry.head)).toEqual(['ψυχή']);
    expect(k.under.map((r) => r.entry.head)).toEqual(['Θρασύμαχος']);
    expect(k.under[0].entry.count).toBe(0);
    expect(k.under[0].expected).toBeCloseTo((30 / (561102 - 22335)) * 22335, 6);
  });
});
