// Re-export of the shared sanitizer and LSJ renderer, so existing app imports
// keep working. The implementation lives in shared/lib/html.ts because the
// shared reader components need it too.
export {
  sanitizeHtml,
  prefixLsjCitationHrefs,
  stampSenseDepth,
  outlineLsjSenses,
  renderLsjEntry,
} from '../../../shared/lib/html';
export type { LsjSenseRef, RenderLsjEntryOptions } from '../../../shared/lib/html';
