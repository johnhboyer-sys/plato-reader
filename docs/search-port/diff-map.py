"""Hunk-by-hunk map of Plato's shared/ search files against aristotle-reader's.

Aristotle adopted Plato's search stack in one commit, 86693cb7ad ("Search
build S1"), from plato-reader 51aa7c3b22, and put back its own behaviour
there (Bekker lines, Busse, authenticity, chapter pages). Plato's copies of
these files are unchanged since 51aa7c3b22. So each hunk of Plato -> Aristotle
origin/main is one of:

  port  new in Aristotle since S1 (the redesign's search), not touching a line
        S1 changed: bring it over
  keep  a line S1 changed and nothing since: Aristotle's own behaviour put
        back over Plato's; Plato keeps its side (Stephanus, speakers, ...)
  both  a hunk that overlaps an S1 change and differs from it: Aristotle's own
        lines changed again by the new work; merge by hand

A port hunk whose Aristotle side names Bekker, chapters, authenticity or
Busse is flagged "port?": new, but likely Aristotle's own.

    python3 docs/search-port/diff-map.py <aristotle checkout at origin/main> > docs/search-port/diff-map-hunks.md
"""
import re
import subprocess
import sys
from pathlib import Path

PLATO = Path(__file__).resolve().parents[2]
S1 = "86693cb7ad"
FILES = [
    "components/Search.svelte", "components/SavedSearches.svelte",
    "lib/search.ts", "lib/search-url.ts", "lib/search-pages.ts", "lib/chapter-pages.ts",
    "lib/result-views.ts", "lib/form-panel.ts", "lib/english-hit.ts", "lib/english-place.ts",
    "lib/paired-hit.ts", "lib/proximity-sentence.ts", "lib/running-text.ts",
    "lib/running-text.worker.ts", "lib/running-match.ts", "lib/greek-keys.ts", "lib/betacode.ts",
    "lib/saved-searches.ts", "lib/speakers.ts", "lib/sect-ticks.ts", "lib/speaker-colors.ts",
    "lib/corpus-tools.ts", "lib/inscription.ts",
    # Not search files, but the new search imports from them.
    "lib/data.ts", "lib/works.ts", "lib/citation.ts",
]
ARISTOTLE_WORDS = re.compile(r"bekker|chapter|authentic|busse|AUTHENTIC", re.I)
HUNK = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")


def git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True).stdout


def hunks(a_text, b_text, tmp):
    """git diff -U0 hunks from a to b: (a_start, a_len, b_start, b_len, removed, added)."""
    pa, pb = tmp / "a", tmp / "b"
    pa.write_text(a_text)
    pb.write_text(b_text)
    out = subprocess.run(["git", "diff", "--no-index", "-U0", "--no-color", str(pa), str(pb)],
                         capture_output=True, text=True).stdout
    res = []
    for line in out.splitlines():
        m = HUNK.match(line)
        if m:
            a0, al, b0, bl = int(m[1]), int(m[2] or 1), int(m[3]), int(m[4] or 1)
            res.append([a0, al, b0, bl, [], []])
        # File headers come before the first hunk only; after it, every
        # -/+ line is content, "++x" and "--x" included.
        elif res and line.startswith("-"):
            res[-1][4].append(line[1:])
        elif res and line.startswith("+"):
            res[-1][5].append(line[1:])
    return res


def span(h):
    """A hunk's left-side lines as a half-open range [a0, a0+al); an insertion
    (len 0) is the point between line a0 and a0+1, given as (a0+1, a0+1)."""
    a0, al = h[0], h[1]
    return (a0, a0 + al) if al else (a0 + 1, a0 + 1)


def overlaps(x, y):
    """Ranges share a line; a point overlaps a range it falls strictly inside,
    and two points overlap when they are the same point."""
    if x[0] == x[1] and y[0] == y[1]:
        return x[0] == y[0]
    if x[0] == x[1]:
        return y[0] < x[0] < y[1]
    if y[0] == y[1]:
        return x[0] < y[0] < x[1]
    return x[0] < y[1] and y[0] < x[1]


def snippet(lines):
    for line in lines:
        s = line.strip()
        if s and s not in ("}", "{", "};", ");", "*/", "-->"):
            s = s.replace("|", "\\|")
            return s[:90] + ("…" if len(s) > 90 else "")
    return "(blank lines)"


def main(aristotle):
    aristotle = Path(aristotle)
    tmp = Path(subprocess.run(["mktemp", "-d"], capture_output=True, text=True).stdout.strip())
    summary = []
    body = []
    for f in FILES:
        g = f"shared/{f}"
        p_path = PLATO / g
        p = p_path.read_text() if p_path.exists() else ""
        s1 = git(aristotle, "show", f"{S1}:{g}")
        a = git(aristotle, "show", f"origin/main:{g}")
        pa = hunks(p, a, tmp)
        ps1 = hunks(p, s1, tmp)
        counts = {"port": [0, 0], "port?": [0, 0], "keep": [0, 0], "both": [0, 0]}
        rows = []
        for h in pa:
            sp = span(h)
            near = [k for k in ps1 if overlaps(sp, span(k))]
            if not near:
                kind = "port?" if ARISTOTLE_WORDS.search("\n".join(h[5])) else "port"
            elif len(near) == 1 and near[0][:2] == h[:2] and near[0][4:] == h[4:]:
                kind = "keep"
            else:
                kind = "both"
            counts[kind][0] += 1
            counts[kind][1] += len(h[4]) + len(h[5])
            plato_lines = f"{h[0]}" + (f"–{h[0] + h[1] - 1}" if h[1] > 1 else "") if h[1] else f"after {h[0]}"
            what = snippet(h[5]) if h[5] else "removes: " + snippet(h[4])
            rows.append(f"| {kind} | {plato_lines} | −{len(h[4])} +{len(h[5])} | `{what}` |")
        summary.append((f, len(p.splitlines()), len(a.splitlines()), counts))
        body.append(f"\n## `shared/{f}`\n")
        if not rows:
            body.append("Identical in both readers.\n")
            continue
        body.append("| kind | Plato lines | size | Aristotle's side starts |\n|---|---|---|---|")
        body.extend(rows)
    print("# Hunk list: Plato `shared/` → Aristotle `origin/main`\n")
    print("Generated by `docs/search-port/diff-map.py`; read `diff-map.md` first.\n")
    print("| file | Plato lines | Aristotle lines | port | port? | keep | both |\n|---|---|---|---|---|---|---|")
    for f, pl, al, c in summary:
        cell = lambda k: f"{c[k][0]} ({c[k][1]})" if c[k][0] else "–"
        print(f"| `{f}` | {pl} | {al} | {cell('port')} | {cell('port?')} | {cell('keep')} | {cell('both')} |")
    print("\nCells: hunks (changed lines).")
    print("\n".join(body))


if __name__ == "__main__":
    main(sys.argv[1])
