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

/** Token containers whose children can hold inline links. */
function childTokensOf(token: Token): readonly Token[] {
  const parts: Token[] = [];
  const candidate = token as {
    tokens?: Token[];
    items?: Token[];
    rows?: Token[][][];
    header?: Token[][];
  };

  if (Array.isArray(candidate.tokens)) parts.push(...candidate.tokens);
  if (Array.isArray(candidate.items)) parts.push(...candidate.items);
  // Table cells nest two levels deeper than everything else.
  if (Array.isArray(candidate.header)) {
    for (const cell of candidate.header)
      parts.push(...((cell as unknown as { tokens?: Token[] }).tokens ?? []));
  }
  if (Array.isArray(candidate.rows)) {
    for (const row of candidate.rows) {
      for (const cell of row)
        parts.push(...((cell as unknown as { tokens?: Token[] }).tokens ?? []));
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
    const candidate = token as { type: string; text?: string; tokens?: Token[] };
    if (
      Array.isArray(candidate.tokens) &&
      candidate.tokens.length > 0 &&
      candidate.type !== 'codespan'
    ) {
      text += flattenText(candidate.tokens, candidate.text ?? '');
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
