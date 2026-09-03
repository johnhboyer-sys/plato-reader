// Only the sanitizer is used from the site since 2026-09-03: the /lemma pages
// mount grammata's T8 entry at runtime instead of rendering the LSJ shards.
// The implementation lives in shared/lib/html.ts because the shared reader
// components need it too.
export { sanitizeHtml } from '../../../shared/lib/html';
