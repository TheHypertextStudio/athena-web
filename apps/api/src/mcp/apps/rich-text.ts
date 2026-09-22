/**
 * `@docket/api` — stored Markdown as a small block model an MCP App card can draw.
 *
 * @remarks
 * A widget runs under a deny-all CSP with nothing to import, and inlining a Markdown parser into
 * every widget document would give the product a second dialect that disagrees with the app. So the
 * server reads the Markdown once, with the same `marked` lexer the rest of the API uses, and hands
 * the card a closed set of block and inline shapes to build with DOM calls. Nothing in the model is
 * HTML: raw HTML is dropped, links are filtered through {@link safeLinkHref}, and text is decoded
 * the way the editor decodes it.
 *
 * The model travels in the tool result's `_meta` (see {@link RENDER_META_KEY}), which the MCP Apps
 * specification forwards to the view and keeps out of the model's context.
 */
import { Lexer, type Token, type Tokens } from 'marked';

import { snippetOf } from '@docket/mail';
import {
  decodeEditorEntities,
  documentFigurePlainText,
  isLineBreakHtml,
  parseDocumentFigureHtml,
  safeLinkHref,
} from '@docket/markdown-tree';

import { markdownToPlainText } from '../../content/markdown-links';

/** The result `_meta` key every Docket card reads its render model from. */
export const RENDER_META_KEY = 'docket/render';

/** A run of inline content. */
export type RichInline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'strong' | 'em' | 'del'; readonly inlines: readonly RichInline[] }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'link'; readonly href: string; readonly inlines: readonly RichInline[] }
  | { readonly kind: 'break' };

/** One item of a list: its own blocks, and its tick when the list is a checklist. */
export interface RichListItem {
  readonly checked?: boolean;
  readonly blocks: readonly RichBlock[];
}

/** One block of a document. */
export type RichBlock =
  | { readonly kind: 'heading'; readonly level: 1 | 2 | 3; readonly inlines: readonly RichInline[] }
  | { readonly kind: 'paragraph'; readonly inlines: readonly RichInline[] }
  | {
      readonly kind: 'list';
      readonly ordered: boolean;
      readonly start?: number;
      readonly items: readonly RichListItem[];
    }
  | { readonly kind: 'quote'; readonly blocks: readonly RichBlock[] }
  | { readonly kind: 'code'; readonly text: string }
  | {
      readonly kind: 'table';
      readonly header: readonly (readonly RichInline[])[];
      readonly rows: readonly (readonly (readonly RichInline[])[])[];
    }
  | { readonly kind: 'divider' };

/** A document ready to draw, with the one-line version a summary slot uses. */
export interface RichText {
  readonly blocks: readonly RichBlock[];
  /** The first paragraph that is not a heading, as plain text, at most {@link EXCERPT_LENGTH}. */
  readonly excerpt: string;
  /** Whether blocks were left off to stay inside the budget. */
  readonly truncated: boolean;
}

/** Limits on how much of a document one card carries. */
export interface RichTextBudget {
  /** Top-level blocks to keep. */
  readonly maxBlocks: number;
  /** Characters of visible text to keep, counted as blocks are added. */
  readonly maxChars: number;
}

/** The authored-summary length the product uses everywhere else. */
const EXCERPT_LENGTH = 280;

/** Enough for a full brief in fullscreen; a card never needs a whole book. */
const DEFAULT_BUDGET: RichTextBudget = { maxBlocks: 80, maxChars: 8000 };

type InlineReader = (token: Token) => readonly RichInline[];

/** Children of an inline container, read as inlines. */
function nested(token: Token): readonly RichInline[] {
  return inlinesOf((token as Tokens.Generic).tokens ?? []);
}

/** How each inline token type becomes zero or more inlines; {@link inlineOf} handles the rest. */
const INLINE_READERS: Readonly<Record<string, InlineReader>> = {
  text: (token) => {
    const text = token as Tokens.Text;
    if (text.tokens && text.tokens.length > 0) return inlinesOf(text.tokens);
    return [{ kind: 'text', text: decodeEditorEntities(text.text) }];
  },
  escape: (token) => [{ kind: 'text', text: (token as Tokens.Escape).text }],
  strong: (token) => [{ kind: 'strong', inlines: nested(token) }],
  em: (token) => [{ kind: 'em', inlines: nested(token) }],
  del: (token) => [{ kind: 'del', inlines: nested(token) }],
  codespan: (token) => [{ kind: 'code', text: (token as Tokens.Codespan).text }],
  br: () => [{ kind: 'break' }],
  link: (token) => {
    const href = safeLinkHref((token as Tokens.Link).href);
    const inlines = nested(token);
    return href ? [{ kind: 'link', href, inlines }] : inlines;
  },
  // An image in a card would be a request to an authored address; its alt text is what it says.
  image: (token) => {
    const alt = (token as Tokens.Image).text;
    return alt ? [{ kind: 'text', text: decodeEditorEntities(alt) }] : [];
  },
  // Raw HTML is dropped, except a line break, which keeps the words either side of it apart.
  html: (token) => (isLineBreakHtml(token.raw) ? [{ kind: 'break' }] : []),
  // A loose checklist item carries its tick marker inside the paragraph; the item already has it.
  checkbox: () => [],
};

/** Read any inline token, including shapes this file does not name, without dropping its words. */
function inlineOf(token: Token): readonly RichInline[] {
  const reader = Object.prototype.hasOwnProperty.call(INLINE_READERS, token.type)
    ? INLINE_READERS[token.type]
    : undefined;
  if (reader) return reader(token);
  const generic = token as Tokens.Generic;
  if (generic.tokens) return inlinesOf(generic.tokens);
  return typeof generic['text'] === 'string' ? [{ kind: 'text', text: generic['text'] }] : [];
}

/** Read a run of inline tokens. */
function inlinesOf(tokens: readonly Token[]): readonly RichInline[] {
  return tokens.flatMap((token) => inlineOf(token));
}

type BlockReader = (token: Token) => readonly RichBlock[];

/** One list item's blocks, without the checkbox marker `marked` puts first in a task item. */
function listItemOf(item: Tokens.ListItem): RichListItem {
  const blocks = blocksOf(item.tokens.filter((token) => token.type !== 'checkbox'));
  return item.task ? { checked: item.checked === true, blocks } : { blocks };
}

/** How each block token type becomes zero or more blocks. */
const BLOCK_READERS: Readonly<Record<string, BlockReader>> = {
  space: () => [],
  def: () => [],
  // A paragraph that was only raw HTML or an image with no alt text has nothing left to show.
  paragraph: (token) => {
    const inlines = nested(token);
    return inlines.length > 0 ? [{ kind: 'paragraph', inlines }] : [];
  },
  // A tight list item wraps its words in a block-level text token.
  text: (token) => [{ kind: 'paragraph', inlines: inlineOf(token) }],
  // The app renders every heading below the second as a third; a card has even less room.
  heading: (token) => {
    const level = Math.min(Math.max((token as Tokens.Heading).depth, 1), 3) as 1 | 2 | 3;
    return [{ kind: 'heading', level, inlines: nested(token) }];
  },
  blockquote: (token) => [{ kind: 'quote', blocks: blocksOf((token as Tokens.Blockquote).tokens) }],
  code: (token) => [{ kind: 'code', text: (token as Tokens.Code).text }],
  hr: () => [{ kind: 'divider' }],
  list: (token) => {
    const list = token as Tokens.List;
    const start = typeof list.start === 'number' ? { start: list.start } : {};
    return [{ kind: 'list', ordered: list.ordered, ...start, items: list.items.map(listItemOf) }];
  },
  table: (token) => {
    const table = token as Tokens.Table;
    return [
      {
        kind: 'table',
        header: table.header.map((cell) => inlinesOf(cell.tokens)),
        rows: table.rows.map((row) => row.map((cell) => inlinesOf(cell.tokens))),
      },
    ];
  },
  // Only the editor's own figure survives, as its caption. Any other HTML is dropped.
  html: (token) => {
    const figure = parseDocumentFigureHtml(token.raw);
    const text = figure ? documentFigurePlainText(figure) : '';
    return text
      ? [{ kind: 'paragraph', inlines: [{ kind: 'em', inlines: [{ kind: 'text', text }] }] }]
      : [];
  },
};

/** Read any block token; an unknown container keeps its children, an unknown leaf is dropped. */
function blockOf(token: Token): readonly RichBlock[] {
  const reader = Object.prototype.hasOwnProperty.call(BLOCK_READERS, token.type)
    ? BLOCK_READERS[token.type]
    : undefined;
  if (reader) return reader(token);
  const generic = token as Tokens.Generic;
  return generic.tokens ? blocksOf(generic.tokens) : [];
}

/** Read a run of block tokens. */
function blocksOf(tokens: readonly Token[]): readonly RichBlock[] {
  return tokens.flatMap((token) => blockOf(token));
}

/** The visible text of a run of inlines. */
export function plainTextOfInlines(inlines: readonly RichInline[]): string {
  return inlines
    .map((inline) => {
      if (inline.kind === 'text' || inline.kind === 'code') return inline.text;
      if (inline.kind === 'break') return ' ';
      return plainTextOfInlines(inline.inlines);
    })
    .join('');
}

/** Characters of visible text in one block, for the budget. */
function lengthOf(block: RichBlock): number {
  switch (block.kind) {
    case 'heading':
    case 'paragraph':
      return plainTextOfInlines(block.inlines).length;
    case 'code':
      return block.text.length;
    case 'quote':
      return block.blocks.reduce((sum, inner) => sum + lengthOf(inner), 0);
    case 'list':
      return block.items.reduce(
        (sum, item) => sum + item.blocks.reduce((inner, b) => inner + lengthOf(b), 0),
        0,
      );
    case 'table':
      return [block.header, ...block.rows]
        .flat()
        .reduce((sum, cell) => sum + plainTextOfInlines(cell).length, 0);
    case 'divider':
      return 0;
  }
}

/** Keep whole blocks, in order, until either limit is reached. */
function withinBudget(
  blocks: readonly RichBlock[],
  budget: RichTextBudget,
): { blocks: RichBlock[]; truncated: boolean } {
  const kept: RichBlock[] = [];
  let chars = 0;
  for (const block of blocks) {
    if (kept.length >= budget.maxBlocks || chars >= budget.maxChars) {
      return { blocks: kept, truncated: true };
    }
    kept.push(block);
    chars += lengthOf(block);
  }
  return { blocks: kept, truncated: false };
}

/** The first paragraph that is not a heading, looking inside quotes and lists when it must. */
function firstParagraph(blocks: readonly RichBlock[]): string {
  for (const block of blocks) {
    if (block.kind === 'paragraph') {
      const text = plainTextOfInlines(block.inlines).trim();
      if (text) return text;
    }
    if (block.kind === 'quote') {
      const inner = firstParagraph(block.blocks);
      if (inner) return inner;
    }
  }
  return '';
}

/**
 * Read stored Markdown into a {@link RichText}.
 *
 * @param markdown - The stored field; empty or missing reads as nothing.
 * @param budget - How much of the document to carry.
 * @returns The block model, its excerpt, and whether it was cut short; `null` for an empty field.
 */
export function richTextOf(
  markdown: string | null | undefined,
  budget: RichTextBudget = DEFAULT_BUDGET,
): RichText | null {
  if (!markdown || markdown.trim() === '') return null;
  const all = blocksOf(new Lexer().lex(markdown));
  if (all.length === 0) return null;
  const { blocks, truncated } = withinBudget(all, budget);
  // A document with no paragraph at all (a bare checklist, say) still says something in one line.
  const lead = firstParagraph(all) || markdownToPlainText(markdown, EXCERPT_LENGTH);
  const excerpt = snippetOf(lead, EXCERPT_LENGTH) ?? '';
  return { blocks, excerpt, truncated };
}
