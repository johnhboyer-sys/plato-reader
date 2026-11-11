// The running-text search's worker: runs findMatches off the page's thread,
// so a pattern that never finishes can be stopped (running-text.ts ends this
// worker when a work takes too long).
import { findMatches } from './running-match';

self.onmessage = (e: MessageEvent<{ text: string; source: string; flags: string }>) => {
  const { text, source, flags } = e.data;
  try {
    const spans = findMatches(text, new RegExp(source, flags));
    (self as unknown as Worker).postMessage({ ok: true, spans }, [spans.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: String(err) });
  }
};
