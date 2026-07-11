"""Citation-scheme contract.

A *citation scheme* is the reference system a work is cited by: Bekker pages for
Aristotle (``1094a15``), Busse/CAG pages for Porphyry's Isagoge (``1.5``), or
Stephanus pages for Plato (``2a``). Each scheme differs in

  * how the export nests its structural divs (a flat page div, or a page div
    containing section divs whose letter composes the citation token),
  * the grammar of a *column* token and a full *ref* (column + line),
  * whether line numbers are shown to the reader,
  * how the validator establishes the *expected* column set — enumerate a
    rectangular page x side range (Bekker), or trust the observed spine
    (Busse, Stephanus, whose page/section spans are irregular and per-work).

Every scheme-conditional in the pipeline dispatches on the `Scheme` returned by
`for_manifest()` / `get()` instead of scattering ``== "busse"`` string tests.

Column-token composition:
  * bekker    — the page div already carries the full column ("16a"); no
                sections. compose_column("16a") -> "16a".
  * busse     — the page div carries a bare page number ("1"); we synthesise a
                single a-side column. compose_column("1") -> "1a".
  * stephanus — a page div ("2") nests section divs ("a".."e"); the column is
                their composition. compose_column("2", "a") -> "2a".
"""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Scheme:
    name: str
    # TEI @type of the page-level div in the Diogenes export.
    page_div_type: str
    # TEI @type of the nested section div whose letter joins the page number to
    # form a column token, or None when the page div IS the column (bekker) or a
    # whole synthetic column (busse).
    section_div_type: str | None
    # Ordered valid section letters; used for display and to order columns that
    # share a page. Bekker's two "sides" (a/b) play the same structural role.
    section_letters: tuple[str, ...]
    # Whether line numbers within a column are meaningful citation targets shown
    # to the reader. Stephanus cites page+letter only; lines are editorial.
    lines_user_facing: bool
    # How stage2 decides the expected column set: "range" enumerates a
    # page x side rectangle (Bekker only); "observed" trusts the spine's own
    # columns (irregular per-work spans; page numbers not globally unique).
    validation_mode: str
    # Sides column_range enumerates, or None when range enumeration is
    # unsupported (a scheme whose columns must never be enumerated rectangularly).
    range_sides: tuple[str, ...] | None
    # Human name of the citation column, for gutters / reports.
    display_label: str
    # Full column-token regex (no line) and full ref regex (column + line).
    column_re: re.Pattern
    ref_re: re.Pattern

    @property
    def has_sections(self) -> bool:
        """True when a column token is page + a nested section letter."""
        return self.section_div_type is not None

    @property
    def bekker_native(self) -> bool:
        """True only for the genuine Bekker scheme; other schemes carry
        synthetic/irregular column tokens that skip Bekker-specific checks."""
        return self.name == "bekker"

    def compose_column(self, page_n: str, section_n: str | None = None) -> str:
        """The column token for a page div (and, for section schemes, the
        current section letter)."""
        if self.name == "bekker":
            return page_n
        if self.name == "busse":
            return f"{page_n}a"
        # stephanus (and any future page>section scheme)
        return f"{page_n}{section_n}"


# Shared line-bearing column grammar. Bekker sides are a/b; Stephanus letters
# a-e. refs.py parses the same range, so a single a-e regex serves both.
_COLUMN_RE = re.compile(r"^(\d+)([a-e])$")
_REF_RE = re.compile(r"^(\d+)([a-e])(\d+)$")


SCHEMES: dict[str, Scheme] = {
    "bekker": Scheme(
        name="bekker",
        page_div_type="Bekker-page",
        section_div_type=None,
        section_letters=("a", "b"),
        lines_user_facing=True,
        validation_mode="range",
        range_sides=("a", "b"),
        display_label="Bekker page",
        column_re=_COLUMN_RE,
        ref_re=_REF_RE,
    ),
    "busse": Scheme(
        name="busse",
        page_div_type="page",
        section_div_type=None,
        section_letters=("a",),
        lines_user_facing=True,
        validation_mode="observed",
        range_sides=None,
        display_label="CAG page",
        column_re=_COLUMN_RE,
        ref_re=_REF_RE,
    ),
    "stephanus": Scheme(
        name="stephanus",
        page_div_type="Stephanus-page",
        section_div_type="section",
        section_letters=("a", "b", "c", "d", "e"),
        lines_user_facing=False,
        validation_mode="observed",
        range_sides=None,
        display_label="Stephanus page",
        column_re=_COLUMN_RE,
        ref_re=_REF_RE,
    ),
}


def get(name: str | None) -> Scheme:
    """The Scheme for a citation-scheme name; None/"" default to bekker."""
    return SCHEMES[name or "bekker"]


def for_manifest(manifest) -> Scheme:
    """The Scheme a manifest declares under `citation.scheme` (default bekker).

    Accepts anything with a `.data` dict (Manifest) or a plain dict."""
    data = getattr(manifest, "data", manifest)
    name = (data.get("citation") or {}).get("scheme") if isinstance(data, dict) else None
    return get(name)
