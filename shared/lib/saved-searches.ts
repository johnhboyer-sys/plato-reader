// Saved searches, kept in this browser only (ruling 4: no accounts).
//
// A search's URL already holds its whole state (search-url.ts), the speaker
// filter's sp/sn included, so an entry is that URL — path and query, no
// origin — with a name, a note and the date it was saved. The list lives
// under one localStorage key. Every read and write is wrapped: a blocked or
// full store makes the feature unavailable (null / false), never an error
// in the search page.

export interface SavedSearch {
  id: string;
  url: string;   // pathname + search, e.g. "/search?g=ψυχή&sp=only&sn=Socrates"
  name: string;
  note: string;
  date: string;  // ISO 8601, when it was saved
}

export const SAVED_KEY = 'plato-saved-searches';

function store(): Storage | null {
  try {
    const s = localStorage;
    const probe = `${SAVED_KEY}-probe`;
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export const savedAvailable = (): boolean => store() !== null;

// Only a same-site path may be saved or imported: an imported file must not
// be able to plant a javascript: or off-site link behind "Open".
export function isSafeUrl(url: unknown): url is string {
  if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//') || url.includes('\\')) return false;
  try {
    return new URL(url, 'https://x.invalid').origin === 'https://x.invalid';
  } catch {
    return false;
  }
}

function clean(raw: unknown): SavedSearch | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isSafeUrl(r.url)) return null;
  const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : summarizeSearch(r.url);
  const note = typeof r.note === 'string' ? r.note : '';
  const date = typeof r.date === 'string' && !Number.isNaN(Date.parse(r.date)) ? r.date : new Date().toISOString();
  const id = typeof r.id === 'string' && r.id ? r.id : newId();
  return { id, url: r.url, name, note, date };
}

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

function read(s: Storage): SavedSearch[] {
  try {
    const parsed = JSON.parse(s.getItem(SAVED_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map(clean).filter((e): e is SavedSearch => e !== null);
  } catch {
    return [];
  }
}

function write(s: Storage, list: SavedSearch[]): boolean {
  try {
    s.setItem(SAVED_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

// The list, newest first; null when the store is blocked.
export function listSaved(): SavedSearch[] | null {
  const s = store();
  return s ? read(s) : null;
}

export function findSaved(url: string): SavedSearch | undefined {
  return listSaved()?.find((e) => e.url === url);
}

// Saves a URL (once: an identical URL returns the entry already there).
export function addSaved(url: string, name?: string, now: Date = new Date()): SavedSearch | null {
  const s = store();
  if (!s || !isSafeUrl(url)) return null;
  const list = read(s);
  const had = list.find((e) => e.url === url);
  if (had) return had;
  const entry: SavedSearch = { id: newId(), url, name: name?.trim() || summarizeSearch(url), note: '', date: now.toISOString() };
  return write(s, [entry, ...list]) ? entry : null;
}

function change(id: string, edit: (e: SavedSearch) => SavedSearch | null): boolean {
  const s = store();
  if (!s) return false;
  const list = read(s);
  const i = list.findIndex((e) => e.id === id);
  if (i < 0) return false;
  const next = edit(list[i]);
  if (next) list[i] = next;
  else list.splice(i, 1);
  return write(s, list);
}

export const renameSaved = (id: string, name: string): boolean =>
  !!name.trim() && change(id, (e) => ({ ...e, name: name.trim() }));
export const noteSaved = (id: string, note: string): boolean => change(id, (e) => ({ ...e, note: note.trim() }));
export const deleteSaved = (id: string): boolean => change(id, () => null);

// The export file: a small versioned wrapper round the list.
export function exportSaved(list: SavedSearch[]): string {
  return JSON.stringify({ kind: 'plato-saved-searches', version: 1, searches: list }, null, 2);
}

// Adds the entries of an export file (or a bare array of entries). Bad
// entries are skipped, and so is a URL the list already holds. null when the
// file is not JSON of that shape, or the store is blocked.
export function importSaved(text: string): { imported: number; skipped: number } | null {
  const s = store();
  if (!s) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const items = Array.isArray(parsed) ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { searches?: unknown }).searches)
      ? (parsed as { searches: unknown[] }).searches
      : null;
  if (!items) return null;
  const list = read(s);
  const urls = new Set(list.map((e) => e.url));
  const added: SavedSearch[] = [];
  for (const raw of items) {
    const e = clean(raw);
    if (!e || urls.has(e.url)) continue;
    urls.add(e.url);
    added.push({ ...e, id: newId() });
  }
  if (added.length && !write(s, [...list, ...added])) return null;
  return { imported: added.length, skipped: items.length - added.length };
}

// A default name read off the URL: the query, then the speaker filter and
// the works, e.g. "ψυχή · spoken by Socrates · in Republic".
export function summarizeSearch(url: string): string {
  let p: URLSearchParams;
  try {
    p = new URL(url, 'https://x.invalid').searchParams;
  } catch {
    return 'Search';
  }
  const list = (v: string | null) => (v ?? '').split(',').filter(Boolean).join(', ');
  const terms = [p.get('g'), p.get('e'), list(p.get('l'))].filter((t): t is string => !!t?.trim());
  const slots = p.getAll('c').map((c) => c.slice(c.indexOf(':') + 1)).filter(Boolean);
  const query = [terms.join(p.get('op') === 'or' ? ' or ' : ' and '), slots.join(' near ')].filter(Boolean).join(' near ');
  const parts = [query || 'Search'];
  const sn = list(p.get('sn'));
  if (sn) parts.push(p.get('sp') === 'except' ? `not spoken by ${sn}` : `spoken by ${sn}`);
  const w = p.get('w');
  if (w) parts.push(w.startsWith('-') ? `not in ${list(w.slice(1))}` : `in ${list(w)}`);
  return parts.join(' · ');
}
