// A lemma's entry in Ast's Lexicon Platonicum on Lexeis (Cornell), from the
// committed table scripts/build-lexeis-ast.mjs writes: LSJ key -> Lexeis
// headword. Nothing here fetches lexeis.org. No entry, no link.
import table from '../../lexeis-ast.json';

export const lexeisAst: Record<string, string> = table;

export function lexeisAstHref(key: string | undefined): string | undefined {
  const token = key ? lexeisAst[key] : undefined;
  return token && `https://lexeis.org/plato/#/entry/${encodeURIComponent(token)}`;
}
