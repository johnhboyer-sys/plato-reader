"""The LSJ fallbacks a lemma tries when no key matches it as spelled, the
curated tables behind them, the corpus analyses patch, and the junk-gloss
guard. The LsjIndex here is built by hand; the corpus checks at the bottom
read Diogenes' LSJ and skip without it."""

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "pipeline"))

from plato_pipeline import stage4_morphology, stage5_lsj
from plato_pipeline.parse_filter import MORPHOLOGY_OVERRIDES
from plato_pipeline.stage4_morphology import apply_analyses_patch, load_analyses_patch
from plato_pipeline.stage5_lsj import (
    LsjIndex,
    joined_compounds,
    junk_gloss,
    load_curated_short_defs,
    load_lsj_aliases,
    match_lemma,
    spelling_variants,
)
from plato_pipeline.stage7_emit import resolve_parses

LSJ = Path("/Applications/Diogenes.app/Contents/dependencies/data/grc.lsj.xml")


def _index(*keys, spellings=None):
    index = LsjIndex()
    for key in keys:
        index.add(key, (spellings or {}).get(key, ()))
    return index


# ── spelling rules ──────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    ("lemma", "key"),
    [
        ("i)/laos", "i(/laos"),                 # Ionic psilosis
        ("o(mi/xlh", "o)mi/xlh"),               # and back
        ("a)ne/romai", "a)nei/romai"),          # ε -> ει (John's report)
        ("mi/gnumi", "mei/gnumi"),              # ι -> ει
        ("a)/meiktos", "a)/miktos"),            # ει -> ι
        ("nouse/w", "nose/w"),                  # ου -> ο
        ("e)mpi/plhmi", "e)mpi/mplhmi"),        # nasal infix
        ("neani/hs", "nea_ni/as"),              # Ionic -ίης
        ("eu)/nous", "eu)/noos"),               # -νους -> -νοος
        ("smikromerh/s", "mikromerh/s"),        # σμικρ- -> μικρ-
        ("dianoe/omai", "dianoe/w"),            # middle under the active
        ("katashmai/nw", "katashmai/nomai"),    # active under the middle
        ("diape/tamai", "diape/tomai"),
        ("parakatati/qemai", "parakatati/qhmi"),
    ],
)
def test_a_spelling_rule_finds_the_lsj_headword(lemma, key):
    assert match_lemma(lemma, _index(key), {}) == ([key], "spelling")


def test_spelling_variants_rewrite_one_place_at_a_time():
    variants = spelling_variants("a)neromai")
    assert "a)neiromai" in variants and "a(neromai" in variants
    assert all(v != "a)neromai" for v in variants)


# ── compounds ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    ("lemma", "joined"),
    [
        ("e)n-ei)mi/", ["e)neimi"]),                 # breathing dropped
        ("dia/-o(ri/zw", ["diorizw"]),                # elision
        ("peri/-ei)=mi", ["perieimi"]),               # περί keeps its ι
        ("su/n-le/gw1", ["sullegw"]),                 # ν -> λ
        ("su/n-pile/w", ["sumpilew"]),                # ν -> μ
        ("e)n-xeire/w", ["e)gxeirew"]),               # ν -> γ
        ("kata/-r(izo/w", ["katarrizow"]),            # ρ doubled
        ("su/n-r(e/w", ["surrew"]),                   # ν -> ρ before ῥ
        ("e)n-r(i/ptw", ["e)rriptw"]),
        ("kata/-e(/zomai", ["kaqezomai"]),            # aspiration
        ("e)k-a)/gw", ["e)cagw"]),                    # ἐκ -> ἐξ
        ("su/n-si_te/w", ["sussitew"]),
        ("su/n-sth/w", ["susthw"]),
        ("su/n,para/-kaqe/zomai", ["sumparakaqezomai"]),
        ("kata/-kaqe/zomai", ["katakaqezomai", "kaqezomai"]),          # doubled
        ("a)mfi/-a)mfisbhte/w", ["a)mfamfisbhtew", "a)mfisbhtew"]),
        ("dia/-di/dwmi", ["diadidwmi"]),     # a two-letter stem never collapses
        ("le/gw", []),
    ],
)
def test_joined_compounds(lemma, joined):
    assert joined_compounds(lemma) == joined


def test_a_compound_takes_its_joined_key():
    assert match_lemma("su/n-le/gw1", _index("sulle/gw"), {}) == (["sulle/gw"], "compound")
    assert match_lemma("kata/-kaqe/zomai", _index("kaqe/zomai"), {}) == (
        ["kaqe/zomai"], "compound")


# ── LSJ's own spellings ─────────────────────────────────────────────────────

def test_an_orth_spelling_names_its_entry():
    index = _index("mei/gnumi", spellings={"mei/gnumi": ["μείγνυμι", "μίγνυμι"]})
    assert match_lemma("mi/gnumi", index, {}) == (["mei/gnumi"], "lsj-spelling")


def test_an_orth_spelling_in_two_entries_names_neither():
    index = _index("ma/la", "mali/r",
                   spellings={"ma/la": ["μάλιστα"], "mali/r": ["μάλιστα"]})
    assert match_lemma("ma/lista", index, {}) is None


def test_a_proper_name_prefers_the_capitalized_entry():
    index = _index("*argos", "a)rgo/s1",
                   spellings={"*argos": ["Ἄργος"], "a)rgo/s1": ["Ἄργος"]})
    assert match_lemma("*)/argos", index, {}) == (["*argos"], "lsj-spelling")


def test_a_lowercase_lemma_finds_a_capitalized_headword():
    assert match_lemma("e(llhni/zw", _index("*(ellhni/zw"), {}) == (
        ["*(ellhni/zw"], "capitalized")


# ── order and precedence ────────────────────────────────────────────────────

def test_no_fallback_moves_a_lemma_that_already_matches():
    # Every fallback would reach another key; the exact match still wins.
    index = _index("a)ne/romai", "a)nei/romai",
                   spellings={"a)nei/romai": ["ἀνέρομαι"]})
    aliases = {"a)ne/romai": "a)nei/romai"}
    assert match_lemma("a)ne/romai", index, aliases) == (["a)ne/romai"], "")


def test_the_alias_beats_the_rules():
    index = _index("a)perw=", "a)pei=pon")
    assert match_lemma("a)po/-e)rw=", index, {"a)po/-e)rw=": "a)pei=pon"}) == (
        ["a)pei=pon"], "alias")
    assert match_lemma("a)po/-e)rw=", index, {}) == (["a)perw="], "compound")


def test_the_spelling_index_beats_the_rules():
    # ἐπιλανθάνομαι: LSJ's ἐπιλανθάνω is a pointer ("v. ἐπιλήθω"); the
    # middle is printed under ἐπιλήθω.
    index = _index("e)pilanqa/nw", "e)pilh/qw",
                   spellings={"e)pilh/qw": ["ἐπιλανθάνομαι"]})
    assert match_lemma("e)pilanqa/nomai", index, {}) == (["e)pilh/qw"], "lsj-spelling")


def test_an_unmatched_lemma_stays_unmatched():
    assert match_lemma("*kebhs", _index("le/gw"), {}) is None


def test_a_miskeyed_capital_shards_where_the_readers_look():
    from plato_pipeline.preflight import _lsj_shard
    for key in ("*Seilhniko/s", "*)/argos", "a)nei/romai", "_"):
        assert stage5_lsj.shard_letter(key) == _lsj_shard(key)


# ── table loaders ───────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "entries",
    [
        {},
        [{"lemma": "a", "lsj": "b"}],
        [{"lemma": "a", "lsj": "", "justification": "j"}],
        [{"lemma": "a", "lsj": "b", "justification": "j"},
         {"lemma": "a", "lsj": "c", "justification": "j"}],
    ],
)
def test_the_alias_loader_rejects_a_malformed_table(tmp_path, entries):
    path = tmp_path / "aliases.json"
    path.write_text(json.dumps(entries))
    with pytest.raises(ValueError):
        load_lsj_aliases(path)


@pytest.mark.parametrize(
    "entries",
    [
        [{"lsj": "a", "short_def": "of", "justification": "j"}],     # junk
        [{"lsj": "a", "short_def": "x y", "justification": ""}],
        [{"lsj": "a", "short_def": "x y"}],
    ],
)
def test_the_short_def_loader_rejects_a_malformed_table(tmp_path, entries):
    path = tmp_path / "short_defs.json"
    path.write_text(json.dumps(entries))
    with pytest.raises(ValueError):
        load_curated_short_defs(path)


# ── junk glosses ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("gloss", ["f", "of", "sṃ", "zd", "of 9 : 8", "u"])
def test_junk_gloss(gloss):
    assert junk_gloss(gloss)


@pytest.mark.parametrize(
    "gloss", ["if", "or", "by", "do", "go", "in", "is", "am", "an", "a", "ox", "I", "", "say", "the letter ζ"])
def test_a_short_real_gloss_is_not_junk(gloss):
    assert not junk_gloss(gloss)


def _parse(gloss, lsj=("i)atriko/s",)):
    return {"lemma": "i)atriko/s", "gloss": gloss, "parse": "fem nom sg", "lsj": list(lsj)}


def test_a_junk_gloss_takes_the_lsj_short_def():
    out = resolve_parses([_parse("of")], {"i)atriko/s": "of or for a physician, medical"})
    assert out[0]["gloss"] == "of or for a physician, medical"


def test_a_junk_gloss_without_a_short_def_ships_blank():
    out = resolve_parses([_parse("f")], {})
    assert out[0]["gloss"] == ""


def test_a_junk_short_def_never_replaces_a_junk_gloss():
    out = resolve_parses([_parse("f")], {"i)atriko/s": "f"})
    assert out[0]["gloss"] == ""


def test_a_real_short_gloss_survives():
    out = resolve_parses([_parse("if", lsj=("ei)",))], {})
    assert out[0]["gloss"] == "if"


def test_a_fallback_match_does_not_rescue_a_spurious_reading():
    # σῇ: 'thy' (σός, LSJ as spelled) and a blank reading whose lemma only a
    # spelling rule resolves. The filter drops the blank one, as before.
    parses = [
        {"lemma": "se/w", "gloss": "", "parse": "p", "lsj": ["sefqei/s"], "fallback": True},
        {"lemma": "so/s", "gloss": "thy, thine", "parse": "p", "lsj": ["so/s"]},
    ]
    assert [p["lemma"] for p in resolve_parses(parses, {})] == ["so/s"]


def test_a_fallback_match_still_opens_its_entry_when_it_is_the_reading():
    parses = [{"lemma": "a)ne/romai", "gloss": "ask", "parse": "p",
               "lsj": ["a)nei/romai"], "fallback": True}]
    assert resolve_parses(parses, {})[0]["lsj"] == ["a)nei/romai"]


def test_no_shipped_table_gloss_is_junk():
    glosses = [e["gloss"] for e in MORPHOLOGY_OVERRIDES.values() if "gloss" in e]
    glosses += [g for e in MORPHOLOGY_OVERRIDES.values()
                for g in e.get("other_glosses", {}).values()]
    glosses += list(load_curated_short_defs().values())
    glosses += [r["gloss"] for e in load_analyses_patch() for r in e.get("readings", [])]
    assert [g for g in glosses if junk_gloss(g)] == []


# ── corpus analyses patch ───────────────────────────────────────────────────

def test_a_from_entry_copies_another_keys_readings():
    found = {"a)po/llwn": [{"lemma": "a)po/-la/w1"}], "*)apo/llwn": [{"lemma": "*)apo/llwn"}]}
    apply_analyses_patch(found, [{"key": "a)po/llwn", "from": "*)apo/llwn", "justification": "j"}])
    assert found["a)po/llwn"] == [{"lemma": "*)apo/llwn"}]
    found["a)po/llwn"][0]["lemma"] = "x"
    assert found["*)apo/llwn"] == [{"lemma": "*)apo/llwn"}]  # a copy, not shared


def test_a_readings_entry_replaces_the_readings():
    found = {"a)/nantes": [{"lemma": "a)na/-a)/ntomai"}]}
    reading = {"lemma": "a)na/nths", "gloss": "up-hill, steep", "parse": "neut nom/voc/acc sg"}
    apply_analyses_patch(found, [{"key": "a)/nantes", "readings": [reading], "justification": "j"}])
    assert [{k: r[k] for k in reading} for r in found["a)/nantes"]] == [reading]


def test_a_from_key_missing_from_the_table_is_an_error():
    with pytest.raises(ValueError):
        apply_analyses_patch({}, [{"key": "x", "from": "*x", "justification": "j"}])


@pytest.mark.parametrize(
    "entries",
    [
        [{"key": "x", "justification": "j"}],                                  # neither
        [{"key": "x", "from": "y", "readings": [], "justification": "j"}],     # both
        [{"key": "x", "readings": [{"lemma": "l"}], "justification": "j"}],
        [{"key": "x", "from": "y", "justification": "j"},
         {"key": "x", "from": "z", "justification": "j"}],                     # duplicate
    ],
)
def test_the_patch_loader_rejects_a_malformed_table(tmp_path, entries):
    path = tmp_path / "patch.json"
    path.write_text(json.dumps(entries))
    with pytest.raises(ValueError):
        load_analyses_patch(path)


# ── against Diogenes' LSJ ───────────────────────────────────────────────────

@pytest.fixture(scope="module")
def lsj_index():
    if not LSJ.exists():
        pytest.skip("requires Diogenes' grc.lsj.xml")
    return LsjIndex.from_file(LSJ)


def test_every_curated_key_is_an_lsj_key(lsj_index):
    curated = list(load_lsj_aliases().values()) + list(load_curated_short_defs())
    assert [k for k in curated if k not in lsj_index.keys] == []


# The lemmata the 44th deploy filed with no entry, and the key each now opens.
CORPUS_CASES = {
    "a)ne/romai": "a)nei/romai", "mi/gnumi": "mei/gnumi", "summi/gnumi": "summei/gnu_mi",
    "a)nami/gnumi": "a)namei/gnu_mi", "u(pomi/gnumi": "u(pomei/gnumi",
    "e)mpi/plhmi": "e)mpi/mplhmi", "paidih/": "paidia/", "ma/lista": "ma/la",
    "nundi/": "nu=n_dh", "ou(twsi/": "ou(/tws", "e)pilanqa/nomai": "e)pilh/qw",
    "prosde/omai": "prosde/w2", "thlikou=tos": "thli^ko/sde", "dianoe/omai": "dianoe/w",
    "i)/laos": "i(/laos", "a)/meiktos": "a)/miktos", "bohqo/s": "bohqo/os",
    "neani/hs": "nea_ni/as", "eu)/nous": "eu)/noos", "du/snous": "du/snoos",
    "deuterei=a": "deuterei=os", "kera/meos": "kera^meou=s", "e(llhni/zw": "*(ellhni/zw",
    "e)nshmai/nomai": "e)nshmai/nw", "pai/wn": "*paiw/n", "parakatati/qemai": "parakatati/qhmi",
    "nouse/w": "nose/w", "o(mi/xlh": "o)mi/xlh", "a)lecifa/rmakon": "a)lecifa/rma^kos",
    "a(rmoniko/s": "*(armoniko/s", "kataxra/w": "kataxra/omai", "u(podu/omai": "u(podu/w",
    "diape/tamai": "diape/tomai", "katashmai/nw": "katashmai/nomai", "si_lhno/s": "*si_lhno/s",
    "ptoi/hsis": "pto/hsis", "o)i/zw": "oi)/zw", "perifu/omai": "perifu/w",
    "smikromerh/s": "mikromerh/s", "pomfo/luc": "pomfo/luz",
    "e)n-ei)mi/": "e)/neimi", "kata/-kaqe/zomai": "kaqe/zomai", "dia/-o(ri/zw": "diori/zw",
    "peri/-ei)=mi": "peri/eimi1", "su/n-le/gw1": "sulle/gw", "a)po/-e)rw=": "a)pei=pon",
    "a)mfi/-a)mfisbhte/w": "a)mfisbhte/w", "para/-kaqe/zomai": "parakaqi/zw",
    "kata/-xra/w2": "kataxra/omai", "su/n-ei)=don": "sunora/w", "a)mfi/-i)/sxw": "a)mpe/xw",
    "su/n-e)piske/ptomai": "sunepiskope/w", "a)mfi/-a)mfie/nnumi": "a)mfie/nnumi",
    "peri/-ei)=don": "periora/w", "e)n-xeire/w": "e)gxeire/w", "dia/-a)nagka/zw": "dia^nagka/zw",
    "a)po/-ei)=don": "a)pei=don", "u(pe/r-ei)=don": "u(perora/w", "su/n-pile/w": "sumpi_le/w",
    "kata/-r(izo/w": "katarrizo/w", "a)po/-e)xqe/w": "a)pexqa/nomai",
    "*lakedaimo/nios": "*la^kedai/mwn", "*)/argos": "*argos", "*)aqh/naze": "*)aqh=nai",
    "*)aqh/nhsin": "*)aqh=nai", "*ferse/fassa": "*persefo/nh",
}


def test_the_corpus_cases_open_their_entries(lsj_index):
    aliases = load_lsj_aliases()
    got = {lemma: (match_lemma(lemma, lsj_index, aliases) or [[None]])[0][0]
           for lemma in CORPUS_CASES}
    assert {k: v for k, v in got.items() if v != CORPUS_CASES[k]} == {}
