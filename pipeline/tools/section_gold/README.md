# Jowett section-start gold sample (2026-11-09)

80 Loeb section starts (offset > 0) drawn at random (seed 20261109) from the
Jowett-paired turns of the 12 Jowett works, by `sample_gold.py` run against the
live site's book JSON. Grok marked where each section begins in Jowett
(`gold_answer_{0,1}.jsonl`: the first words of Jowett at the boundary, verbatim,
with a confidence). Machine-made, not a human reading; spot-checked by hand.

Batch 0 was looked at while building `align_sections.py`; batch 1 was held out.

    cd pipeline
    python tools/eval_section_match.py ../build/dist tools/section_gold/gold_sample.json \
        tools/section_gold/gold_answer_0.jsonl tools/section_gold/gold_answer_1.jsonl

Results at commit time (75 usable items):

| | proportional | matched |
|---|---|---|
| batch 1 (held out), within 30 chars | 51% | 85% |
| batch 1, exact word | 15% | 59% |
| both, within 30 chars | 63% | 88% |
| both, median error | 23 chars | 4 chars |

`gold_sample.json` stores each turn's text, but the eval re-reads the turn from
`build/dist`, so run it against a build whose Euthyphro…Theaetetus turns match
the live data of 2026-11-09 (a rebuild that shifts turn indices invalidates it).
