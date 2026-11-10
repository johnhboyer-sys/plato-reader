# Search sidebar and the phone design: handoff

Written 2026-11-10 by the session that built PRs #86–#91. A new session picks up here.
Read this first, then `docs/search-tlg-plan-handoff.md` (the nine-PR plan this work belongs to).

The running log of every ruling is outside the repo, with the preview scripts and the phone mockups:

    ~/Library/Application Support/Claude/side-session-notes/local_11abdc30-4601-4c0d-a959-91bc439f5d27/
      plato-paired-hits-and-tlg-plan-notes.md   the log
      preview-tools/                            shot.mjs, mock.js, mockshot.mjs, phone.js, phoneshot.mjs
      phone-P4-mockups/                         the pictures John reacted to

## Where things stand

| PR | What | State |
|---|---|---|
| #86 | Paired hits (Greek with its English) | merged |
| #87 | Form panel (TLG plan 1/9) | merged |
| #88 | Views and grammar facets (2/9) | merged |
| #89 | Small fixes (tick boxes, stuck "Searching…") | merged |
| #90 | Reading the results (3/9) | merged 2026-11-10 on John's word |
| #91 | Sidebar | merged 2026-11-10 on John's word, after #90 |

Nothing is deployed. Deploying is John's call, always.

John gave the go-ahead to merge both in his own words ("Merge #90, then #91?" "Yes"). If `git log
origin/main` does not show both, the merge did not finish: check the PRs before doing anything else.

## What #91 now holds

In commit order after the first sidebar build:

1. `e8b1eaac55` Sort reads Stephanus order / Works A–Z / Forms A–Z / Commonest form first. `so=` values unchanged.
2. `6fe014d962` **Set B**, which John picked from six labelled mockups:
   - rows about 30 px in the sidebar under `(min-width: 1100px) and (pointer: fine)`; 40 px elsewhere;
   - Group by, Sort, Context and Per page are one-line menus in a bar over the hits
     (`div.sopt.sx-display`, first child of `.sx-main`), built as the search form's `details.opt` menus are.
     A choice applies at once and shuts the menu; arrow keys step with the menu open; Enter shuts it;
   - Works shows five, then "N more";
   - Forms shows every form in `.fx-list`, a box of set height with its own scroll, headword pinned
     at its top, Deselect all and Apply outside it (John: "keep it set height and add scroll");
   - Grammar sits straight under Forms, each category's values as tick-box chips on one line.
3. `e55f021ef0` a rule under the forms box.
4. `10aee1e3d7` a lone headword is named over its forms (John: "Headword above forms checkboxes").
   `formGroups` returns a null headword only for a search by form.
5. `0d7788e9a3` Codex fixes: the forms box is its own stacking context; the arrow-key flag lasts one
   turn; Enter is stopped so the menu does not reopen; a ticked chip is underlined under forced colours.
6. `68f747d049` the search page's footer leaves out the links to the other readers
   (John: "we don't need other site links on search page"). `SiteFooter` takes `sisters={false}`.
   Codex: no findings.

Tests at `68f747d049`: `cd shared && npx vitest run` 1,080 pass, 1 skipped; `npm run check` clean;
`cd app && npx vitest run` 13 pass.

## Next: the phone design (not built)

John, 2026-11-10: "Mobile will need another round of previews. Different form factor = diff design."
The phone layout now in #91 (the bar wrapping to three lines, the forms scrolling inside the Refine
sheet) is a first attempt he has **not** approved.

He was shown P1 (one button), P2 (chip rail), P3 (two buttons with tabs), then asked for **P4**:
"why not have a refine/filter icon? and a sort button?" He has not yet said "build it", but every
correction since has been to P4. Its mockups are in `phone-P4-mockups/`; `phone.js` draws them.

P4 as it stands after his corrections:

- **One row, no wrap:** the count ("20848 instances · page 637 of 637"), then a filter icon and a sort
  icon at the right end. His words: "on the same row. not separate. no wrap. adjust n instances and
  page n of n text so the both fit."
- **No boxes round the icons** ("why the boxes around them?"). Keep a 44 px tap height all the same.
- **The text gives way, not the icons.** The mock sizes it in CSS from the row's width and the text's
  length (`container-type: inline-size` on the row, `font-size: min(1.25rem, calc((100cqi - 3.375rem)
  / (var(--n) * 0.43)))`, `--n` the letter count). Measured in the mock on the longest line: full size
  at 390, 18.7 px at 360, 15.9 px at 320, clear of the icon each time. Those constants were tuned by
  eye in a mock. In the build, test the fit in a real browser at 320, 360 and 390, and with a
  six-digit count.
- **Filter icon** opens a short menu: Works, Forms, Grammar (and Translations where a search has
  them), each row showing what is set. A row opens its own full screen (`P1-c-forms.png` shows the
  forms one: headword, every form, Deselect all and Apply fixed at the foot). No list scrolls inside
  a sheet that also scrolls. A badge on the icon counts the filters in force.
- **Sort icon** opens one sheet, "Sort & display": Sort first, then Group by, Context, Per page.
  Use the site's square choice boxes (`label.ck`), not the round pills the mock drew.
- Desktop is untouched.

Not yet settled; ask John, with labelled pictures:

1. Prev / Next: its own line under the count row (as mocked), or dropped at the top on a phone, or
   folded into the row as arrows.
2. A small word under each icon, or icons alone. Either way the icons need accessible names.
3. Where "This search" (the chosen things with their ×) lives on a phone. The mock does not show it.
   Top of the filter menu is the obvious place.
4. Which widths get P4. The sheet takes over below 1100 px today, which includes tablets.
5. The Grammar view and the dark theme on a phone were never mocked.

Build it as its own PR from `main`.

## Next: no Stephanus headings over the hits (ruled, mockup approved, not built)

John, 2026-11-10: "Why the collapsible expandable Stephanus heading over results? I don't find that
helpful. Collapsable work headings for results? Yes. But stephanus? Nah. Those are just page and
section groups. Nothing more."

Today the default view puts each Stephanus page under a heading that opens and shuts
(`button.group-head`: "STEPHANUS 18 · 18a–18e · 1 instance"), shut when it holds more than one hit.
It came over from the Aristotle reader, where the group was a chapter.

What he wants: the hits listed plainly under the work's heading, each with its section (18a) as now,
and the **work** heading the thing that opens and shuts. Mocked in `S-2-flat-desktop.png` and
`S-4-flat-phone.png` (`flat.js` in the preview tools). He approved the mockup: the headings "just
add clicks", and the proposed page is "much better".

Settled with him:

- **Build it in the new session, as its own PR from `main`.**
- **Group by reads Work (the default) / Form / Grammar.** With the Stephanus groups gone, "By
  Stephanus page" and "By work" showed nearly the same thing. Let `v=work` in an old address fall
  back to the default.

- **A one-book work drops its "BOOK 1" label** ("One book work drop 'Book 1' label for sure").
  Today the heading reads "Apology BOOK 1". Do it in the same PR.

Still to ask:

1. Whether the form and grammar views keep their folding groups (I assume yes: he objected to the
   Stephanus ones only).

Many tests open the shut groups first (`button.group-head[aria-expanded="false"]`); they will need
care, not deletion.

## Also open

- **Forms box height on desktop.** Six and a half rows as built. A plain search leaves about 170 px
  spare at 1280×900, so about ten rows would still fit. Asked twice, not answered.
- **The long note under the speaker picker** ("Greek hits are held to the word…") still stands. Only
  the note under the results was cut to one line.
- **Sort is page-bound:** it reorders the hits of the page in view, never across pages. John has
  been told; no ruling.
- **At 320 px wide** the group heads ("STEPHANUS 2 · 2a–2d · 11 instances") wrap into three ragged
  columns. Not caused by this work; seen in `P4-f-top-small-phone.png`.
- **The × in "This search"** sticks out 6–8 px past the column in the tight sidebar.

## After that: the TLG plan

`docs/search-tlg-plan-handoff.md`, in strict order, each branched from `origin/main` after the last
merged: PR 4 (full wildcards and NOT; its form-vocabulary file carries an accented spelling per form,
and the form panel prints it), 5, 6, 7, 8, 9, then **PR 10** (stage 6 files a turn-aligned
translation's words under the section they fall in; rebuild in canonical order, pass
`verify-rebuild`; John wants screenshots before it merges; take the example from a Jowett work such
as the Republic, Gorgias or Phaedrus, not the Timaeus).

## How John wants this run

- **Previews as you go, and no merge before he signs off on them.** Applies to every PR that changes
  what a page looks like.
- **Label every picture** in the picture itself. He will not match files to a caption.
- When he asks for options he wants them all, then mockups of the ones he names, then the build.
- He reads on a phone much of the time. Keep messages short, lead with what he must decide.
- Merging on green without asking was his rule for the plan PRs in the earlier session only
  ("instructions for this session, not a new rule for all sessions"). Ask again.
- The writing and coding rules in `~/.claude/CLAUDE.md` bind: a test that fails first, changes that
  trace to the ask, Codex (`--model gpt-6.1-sol --effort medium`, findings only) reviews Claude's
  work, and review passes repeat until one comes back clean.

## Working notes

- Node 22: `export PATH=~/.nvm/versions/node/v22.23.1/bin:$PATH`.
- Dev server: `.claude/launch.json` (untracked) has `plato-dev` on port 4377; start it with the
  browser pane's preview tool. It stops between turns: check the port before shooting.
  Data: `cp -Rc <main checkout>/build/dist build/dist`.
- Previews: `shot.mjs` drives playwright-core with the cached headless Chromium. It takes one JSON
  job (`url`, `out`, `width`, `height`, `scheme`, `touch`, `steps`, `label`, `clip`, `downTo`).
  `label` burns the band into the picture. `mock.js` and `phone.js` are overlays for mockups:
  they restyle the live page, they are not the build. The scripts expect `node_modules/playwright-core`
  beside them (clone it from another worktree with `cp -Rc`).
- The test DOM (happy-dom) has no native key actions: arrow keys do not move a radio and Enter does
  not press a focused button. Check keyboard behaviour in the headless browser as well.
- Headless shots never show a scroll bar. Do not claim one is visible on their evidence.
- Search.svelte styles are component-scoped; print rules for the page live in `shared/styles/global.css`.
- Do not `git checkout -- <file>` to undo a deliberate break while fixes in that file are uncommitted.
  It was done twice here. Commit first, or copy the file aside.
