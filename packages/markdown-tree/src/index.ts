/**
 * `@docket/markdown-tree` — the primitives every `marked` token-tree walker in the product shares.
 *
 * @remarks
 * Three places walk a `marked.lexer` token tree with their own opinion on what to do with each
 * shape: `apps/web/src/components/editor/render-markdown-tokens.tsx` (a full document, every block
 * becomes its own DOM element), `apps/web/src/components/mentions/excerpt-markdown.tsx` (a
 * reduced-fidelity single-line hovercard excerpt), and `apps/api/src/content/markdown-links.ts`
 * (a fully flattened plain-text excerpt, plus link extraction). The full-document renderer needs
 * type-specific access to build real `<ul>`/`<table>` structure, so it stays its own thing — but
 * the other two only ever need "what are this token's children" and "which token types aren't
 * real prose," and used to each answer those questions with their own, independently-maintained
 * logic. They already disagreed once (one flattened table cells into an excerpt, the other dropped
 * tables outright) before anyone noticed. This package is the one place both now answer from.
 */
import type { Token } from 'marked';

/** A token that may carry inline children, which is most of them. */
interface TokenWithChildren {
  readonly tokens?: readonly Token[];
}

/** A token whose own text contributes to flattened output when it has no children to descend into. */
export interface TextualToken extends TokenWithChildren {
  readonly type: string;
  readonly text?: string;
}

/**
 * The container shapes `marked` uses, gathered into one type.
 *
 * @remarks
 * `marked`'s `Token` union does not expose these uniformly; naming them here avoids a cast at
 * every access, so a shape change fails to compile rather than silently missing content.
 */
interface TokenContainer extends TokenWithChildren {
  /**
   * The token kind.
   *
   * @remarks
   * Required so this is not an all-optional interface, which TypeScript's weak-type check would
   * reject a `Token` from when it carries none of the other fields.
   */
  readonly type: string;
  /** List items. */
  readonly items?: readonly Token[];
  /** Table body cells, nested one level deeper than everything else. */
  readonly rows?: readonly (readonly TokenWithChildren[])[];
  /** Table header cells. */
  readonly header?: readonly TokenWithChildren[];
}

/** Read the inline children of a table cell, which are one indirection further in. */
function cellTokens(cell: TokenWithChildren): readonly Token[] {
  return cell.tokens ?? [];
}

/** Read a token as a container; one carrying no child fields reads as having no children. */
function asContainer(token: Token): TokenContainer {
  return token;
}

/**
 * The children of any `marked` token, regardless of shape — a paragraph's inline tokens, a list's
 * items, a table's header and row cells, all flattened into one array in document order.
 *
 * @remarks
 * A token with no children of its own (a leaf) returns an empty array; callers use that as the
 * signal to read the token's own `text` instead. Deliberately flattens table cells into the same
 * array as everything else, rather than preserving row/column structure — the two consumers this
 * serves (a plain-text excerpt, a reduced-fidelity inline excerpt) both just want the reachable
 * text, not a table shape they'd have no way to render anyway.
 */
export function childTokensOf(token: Token): readonly Token[] {
  const container = asContainer(token);
  const parts: Token[] = [];

  if (container.tokens) parts.push(...container.tokens);
  if (container.items) parts.push(...container.items);
  if (container.header) {
    for (const cell of container.header) parts.push(...cellTokens(cell));
  }
  if (container.rows) {
    for (const row of container.rows) {
      for (const cell of row) parts.push(...cellTokens(cell));
    }
  }
  return parts;
}

/**
 * Non-prose block kinds an excerpt should never quote: source, structure, or markup, not words.
 *
 * @remarks
 * `table` is skipped for the same reason `code` is: a table's cells flattened into a single line
 * of text lose the row/column structure that made them readable, so a jumbled fragment isn't a
 * better excerpt than no fragment at all. This is the one skip-list both excerpt-producing walkers
 * use — see this package's own remarks for why that used to not be true.
 */
export const EXCERPT_SKIP_TOKEN_TYPES: ReadonlySet<string> = new Set([
  'code',
  'table',
  'space',
  'hr',
  'html',
  'def',
]);
