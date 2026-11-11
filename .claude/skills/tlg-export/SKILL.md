---
name: tlg-export
description: Re-export Plato's Greek (TLG corpus 0059) from Diogenes.app to build/export XML — the verified v4.7.2 recipe and its traps. Use before any TLG/Diogenes export or a from-scratch pipeline rebuild.
---

# TLG export (verified 2026-11-09)

- **TLG export recipe (verified 2026-11-09):** Diogenes.app is now v4.7.2, whose xml-export.pl has `-y`
  natively (`docs/diogenes-xml-export-y.patch` was for the old v4.5 and no longer applies) and whose Base.pm
  reads a `TLG_DIR` env var. A scratch `diogenes.prefs` alone did NOT take effect (every TLG file reported
  missing). Working recipe:
  1. Copy `/Applications/Diogenes.app/Contents/server/xml-export.pl` somewhere writable, unmodified.
  2. Run: `TLG_DIR="/Users/johnboyer/Documents/CLAUDE CODE ARISTOTLE PROJECT/TLG Files/TLG" Diogenes_Config_Dir=<empty scratch dir> PATH=/usr/bin:/bin perl -I /Applications/Diogenes.app/Contents/server -I /Applications/Diogenes.app/Contents/dependencies/CPAN xml-export-local.pl -c tlg -n 0059 -y -o <repo>/build/export` → `build/export/Diogenes-Resources/xml/tlg/tlg0059NNN.xml` (41 files, ~9 MB).
  The 4.7.2 export rebuilt every work's book JSON identical (parsed-JSON comparison) to the 4.5-based live data, and the lemma slug set byte-identical (46th deploy).
  Never modify /Applications/Diogenes.app itself (its dependencies/data carries the stage4/5 morphology data).
