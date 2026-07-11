"""Column/line reference utilities, shared across citation schemes.

A *column* is a citation-page token: a Bekker page+side like "1094a", or a
Stephanus page+section like "17e". A *ref* adds a line number, e.g. "1094a15"
or "17e3". Columns order by (page number, letter); refs add the line as a third
key. The letter axis spans a-e so the same parser serves Bekker sides (a/b) and
Stephanus sections (a-e); ordering therefore places 17e before 18a correctly.

`column_range` enumerates a rectangular page x side range and is BEKKER-ONLY:
Stephanus/Busse spans are irregular (works start and end mid-page and interior
pages are not guaranteed to carry every letter), so their expected column set
comes from the observed spine, never from enumeration. Callers on those schemes
must not invoke it.
"""

from __future__ import annotations

import re

_REF_RE = re.compile(r"^(\d+)([a-e])(\d+)?$")


def column_key(column: str) -> tuple[int, str]:
    m = _REF_RE.match(column)
    if not m or m.group(3) is not None:
        raise ValueError(f"not a column token: {column!r}")
    return (int(m.group(1)), m.group(2))


def ref_key(ref: str) -> tuple[int, str, int]:
    """Sort key for a full ref like '1103a14' or '17e3'."""
    m = _REF_RE.match(ref)
    if not m or m.group(3) is None:
        raise ValueError(f"not a ref: {ref!r}")
    return (int(m.group(1)), m.group(2), int(m.group(3)))


def line_key(column: str, line: int) -> tuple[int, str, int]:
    page, side = column_key(column)
    return (page, side, line)


def column_range(first: str, last: str, sides: tuple[str, ...] = ("a", "b")) -> list[str]:
    """All columns from `first` to `last` inclusive over `sides` (Bekker only).

    Enumerates the page x side rectangle. `sides` defaults to Bekker's a/b;
    it exists so the Bekker caller is explicit, NOT so other schemes can
    enumerate — Stephanus/Busse expected columns come from the observed spine.
    """
    fp, fs = column_key(first)
    lp, ls = column_key(last)
    out = []
    for page in range(fp, lp + 1):
        for side in sides:
            if (page, side) < (fp, fs) or (page, side) > (lp, ls):
                continue
            out.append(f"{page}{side}")
    return out
