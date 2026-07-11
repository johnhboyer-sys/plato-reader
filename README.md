# The Plato Reader

A static web application for reading the complete works of Plato with the
original Greek and a public-domain English translation side by side, cited by
Stephanus page and section (e.g. `34b`) rather than line numbers.

Architecture mirrors its sister project, [aristotle-reader](https://github.com/johnhboyer-sys/aristotle-reader)
(same pipeline / shared / app layout, same build and deploy conventions) —
see that repo's docs and git history for background on the shared machinery.
This repo is a fresh scaffold copied from it; Plato-specific work (Stephanus
citations, the dialogue registry, etc.) is a separate, later phase.

## Requirements

- **Node.js 22** — for the Astro app (`shared/` and `app/`)
- **uv** — Python package manager, for the `pipeline/`
- **TLG corpus** (licensed, not included) — required locally to run the
  pipeline; TLG text is never committed to this repo

See `CLAUDE.md` for the hard rules (copyright, deploy gates, build gotchas)
and `ADDING-A-WORK.md` for the per-work build recipe (adapted from
aristotle-reader; Stephanus-specific steps are still TBD).

## MIT Licence

Copyright © 2026 John Boyer

Permission is hereby granted, free of charge, to any person obtaining a copy of this software to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.
