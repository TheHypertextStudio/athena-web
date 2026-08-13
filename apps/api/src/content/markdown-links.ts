/**
 * Extract the links an author wrote in a Markdown field, in document order.
 *
 * @remarks
 * Pure and lexer-based on purpose. A regex over the raw string is the obvious implementation and
 * it is wrong: it matches inside fenced code blocks and inline code spans, so a document *about*
 * Markdown would grow phantom mentions that no one can delete because they are not really there.
 *
 * The lexer is `marked`, pinned to the major `@tiptap/markdown` uses, so the server extracts
 * exactly what the editor serialized. If the two ever disagree about what a link is, a mention
 * silently fails to reach the Resources tab — a bug with no error and no stack trace.
 */
import { Lexer, type Token, type Tokens } from 'marked';

import { snippetOf } from '@docket/mail';

/** One link found in a Markdown field. */
export interface MarkdownLink {
  /** Visible link text, with Markdown emphasis flattened away. */
  readonly label: string;
  /** The link target exactly as authored. */
  readonly href: string;
  /** The link's title slot, when it has one; this is where a mention marker rides. */
  readonly title: string | undefined;
  /** Ordinal in document order, starting at zero. */
  readonly position: number;
}

/** A token that may carry inline children, which is most of them. */
interface TokenWithChildren {
  readonly tokens?: readonly Token[];
}

/** A token whose own text contributes to a flattened label. */
interface TextualToken extends TokenWithChildren {
  readonly type: string;
  readonly text?: string;
}

/**
 * The container shapes marked uses, gathered into one type.
 *
 * @remarks
 * `marked`'s `Token` union does not expose these uniformly; naming them here avoids a cast at
 * every access, so a shape change fails to compile rather than silently missing links.
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

/** Token containers whose children can hold inline links. */
function childTokensOf(token: Token): readonly Token[] {
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
 * Walk a token tree, collecting links and refusing to descend into code.
 *
 * @param tokens - Tokens to walk.
 * @param out - Accumulator, appended in document order.
 */
function collectLinks(tokens: readonly Token[], out: MarkdownLink[]): void {
  for (const token of tokens) {
    // `code` is a fenced or indented block; `codespan` is inline backticks. Neither contains
    // links a reader could click, so neither contains mentions.
    if (token.type === 'code' || token.type === 'codespan') continue;

    if (token.type === 'link') {
      const link = token as Tokens.Link;
      out.push({
        label: flattenText(link.tokens, link.text),
        href: link.href,
        // A missing title arrives as undefined from one lexer path and null from another;
        // collapse both, plus the empty string, so consumers test one thing.
        title:
          link.title === null || link.title === undefined || link.title === ''
            ? undefined
            : link.title,
        position: out.length,
      });
      // Deliberately no descent: a link nested inside a link is not expressible in Markdown,
      // and descending would double-count the label's own tokens.
      continue;
    }
    collectLinks(childTokensOf(token), out);
  }
}

/** Reduce a link's inline tokens to plain text, so `[**Q3** plan]` yields `Q3 plan`. */
function flattenText(tokens: readonly Token[], fallback: string): string {
  if (tokens.length === 0) return fallback;
  let text = '';
  for (const token of tokens) {
    const candidate: TextualToken = token;
    const children = candidate.tokens;
    if (children && children.length > 0 && candidate.type !== 'codespan') {
      text += flattenText(children, candidate.text ?? '');
    } else {
      text += candidate.text ?? '';
    }
  }
  return text === '' ? fallback : text;
}

/**
 * Find every link in a Markdown string, in document order.
 *
 * @param markdown - The stored Markdown field, which may be empty.
 * @returns The links, each carrying its ordinal position.
 *
 * @example
 * ```typescript
 * extractMarkdownLinks('See [the plan](https://x "docket:v1:external").');
 * // [{ label: 'the plan', href: 'https://x', title: 'docket:v1:external', position: 0 }]
 * ```
 */
export function extractMarkdownLinks(markdown: string): readonly MarkdownLink[] {
  if (markdown.trim() === '') return [];
  const out: MarkdownLink[] = [];
  collectLinks(new Lexer().lex(markdown), out);
  return out;
}

/** Non-prose block kinds an excerpt should never quote: source, structure, or markup, not words. */
const EXCERPT_SKIP_TOKEN_TYPES: ReadonlySet<string> = new Set([
  'code',
  'space',
  'hr',
  'html',
  'def',
]);

/**
 * Walk a token tree, reducing it to the plain words a reader would see, in document order.
 *
 * @remarks
 * Generalizes {@link flattenText}'s "prefer parsed children over raw source" rule to every block
 * shape the lexer produces, not just a link label: `childTokensOf` already knows how to reach into
 * a list's items or a table's cells, so a token with no children of its own is the only case that
 * contributes its own `text` — which is exactly the recursive-descent-then-leaf shape a heading,
 * a paragraph, a nested list, and a blockquote all share.
 *
 * `budget` bounds the walk itself, not just the final output: once enough text has been collected,
 * later sibling blocks are never visited or joined at all. A multi-section Initiative description
 * only needs its opening sections lexed-and-walked to produce a 280-character excerpt, not every
 * section all the way to the end — the budget is what keeps that true. It's deliberately generous
 * versus the eventual `maxLength` (the caller still truncates at a word boundary afterward), since
 * cutting a block off at exactly the display limit would leave `snippetOf` no slack to break on a
 * word rather than mid-token.
 *
 * @returns `true` once `budget.charsRemaining` has been exhausted, so a recursive caller knows to
 *   stop visiting further siblings too, rather than only stopping its own loop.
 */
function collectPlainText(
  tokens: readonly Token[],
  out: string[],
  budget: { charsRemaining: number },
): boolean {
  for (const token of tokens) {
    if (budget.charsRemaining <= 0) return true;
    if (EXCERPT_SKIP_TOKEN_TYPES.has(token.type)) continue;

    const children = childTokensOf(token);
    if (children.length > 0) {
      if (collectPlainText(children, out, budget)) return true;
      continue;
    }

    const candidate: TextualToken = token;
    if (typeof candidate.text === 'string' && candidate.text !== '') {
      out.push(candidate.text);
      budget.charsRemaining -= candidate.text.length + 1; // +1 for the join separator.
    }
  }
  return false;
}

/**
 * Reduce a Markdown field to a flat, plain-text excerpt — for anywhere a preview shows a snippet
 * of prose rather than rendering it, so `# Executive Summary` reads as "Executive Summary" instead
 * of a literal hash the reader has to mentally discard.
 *
 * @remarks
 * Truncation is delegated to `snippetOf` (`@docket/mail`) rather than re-implemented here, so this
 * excerpt and a mail-preview excerpt collapse whitespace and truncate the same way, tuned once in
 * one place. Like `snippetOf`, this prefers a word boundary but is not guaranteed to find one: a
 * source whose first `maxLength` characters contain no whitespace at all (a long pasted URL, for
 * instance) still falls back to a hard cut — there is no word boundary to break on in that case,
 * only a shorter or longer wrong place to cut.
 *
 * @param markdown - The stored Markdown field, which may be empty.
 * @param maxLength - Longest excerpt to return, in characters. Defaults to 280, matching the
 *   product's own authored-summary length convention.
 * @returns Plain text with headings, emphasis, and links flattened to words, blocks joined by a
 *   single space, and — only when the source exceeds `maxLength` — truncated with a trailing
 *   ellipsis.
 *
 * @example
 * ```typescript
 * markdownToPlainText('# Executive Summary\n\nWe are going to *ship* it.');
 * // 'Executive Summary We are going to ship it.'
 * ```
 */
export function markdownToPlainText(markdown: string, maxLength = 280): string {
  if (markdown.trim() === '') return '';
  const parts: string[] = [];
  // Headroom beyond `maxLength`, not the limit itself: `snippetOf` needs slack past the display
  // length to find a real word boundary to break on, rather than being handed a string already
  // cut exactly at the limit.
  collectPlainText(new Lexer().lex(markdown), parts, { charsRemaining: maxLength * 2 });
  return snippetOf(parts.join(' '), maxLength) ?? '';
}
