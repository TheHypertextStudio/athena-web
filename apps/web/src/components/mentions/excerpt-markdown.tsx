'use client';

/**
 * A reduced-fidelity Markdown excerpt — for a hovercard preview, not a reading surface.
 *
 * @remarks
 * `StaticMarkdown` (`../editor/static-markdown`) renders a full document: separate `<h1>`/`<p>`/
 * `<table>` block elements. That is the wrong shape here — `line-clamp` only reliably truncates
 * text wrapping *within* one block, not across several sibling block elements, so dropping a full
 * document render into a 3-line-clamped card would show anything from a bare heading to an
 * unclamped wall of content depending on what the source happened to lead with.
 *
 * This renders every block into the *same* flowing line instead: a heading becomes bold lead-in
 * text rather than its own `<h1>`, a list item becomes an inline bullet rather than a `<li>`, and
 * the whole thing is one run of inline nodes a single `line-clamp` can truncate normally. Emphasis,
 * links, and inline code still render for real — "reduced fidelity" describes the block layout,
 * not the inline formatting.
 *
 * The value this renders is already cut to a preview length server-side
 * (`excerptMarkdownOf` in `apps/api/src/content/mention-hydrate.ts`), generously rather than at a
 * syntactically safe boundary — a truncated `**bold` or `[link](h` degrades to ordinary text under
 * `marked`'s lexer rather than throwing. The one syntax that doesn't degrade gracefully, an
 * unterminated fenced code block, is guarded against upstream in `excerptMarkdownOf` itself (it
 * would otherwise swallow the rest of the excerpt into one `code` token, which
 * `EXCERPT_SKIP_TOKEN_TYPES` below then drops entirely) rather than here, since the fix requires
 * the original, un-lexed text.
 *
 * This is also one of *three* independent places in the codebase that walk a Markdown token tree
 * with their own opinion on which block shapes to handle: `render-markdown-tokens.tsx`'s
 * `renderBlocks` (a full document, every block becomes its own DOM element, so it needs real
 * per-shape structure and stays its own thing), `markdown-links.ts`'s `collectPlainText` (a fully
 * flattened, single-line plain-text excerpt), and this one (a reduced-fidelity
 * single-line-but-still-formatted excerpt). The latter two share their token-walking primitives —
 * `childTokensOf` and `EXCERPT_SKIP_TOKEN_TYPES` — via `@docket/markdown-tree`, so they can no
 * longer silently disagree about which token types exist or which aren't real prose; what each one
 * *does* with a given shape (fold into one line here, flatten to plain text there) still differs by
 * design, and a change to one is still worth checking against the other.
 */
import { marked, type Token, type Tokens } from 'marked';
import { Fragment, type JSX, type ReactNode, useMemo } from 'react';

import { EXCERPT_SKIP_TOKEN_TYPES, childTokensOf } from '@docket/markdown-tree';

import { renderInline } from '../editor/render-markdown-tokens';

function renderExcerptBlocks(tokens: readonly Token[], prefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  tokens.forEach((token, index) => {
    const key = `${prefix}-${index}`;
    if (EXCERPT_SKIP_TOKEN_TYPES.has(token.type)) return;

    if (token.type === 'heading') {
      nodes.push(
        <Fragment key={key}>
          <strong>{renderInline(childTokensOf(token), key)}</strong>{' '}
        </Fragment>,
      );
      return;
    }

    if (token.type === 'list') {
      const list = token as Tokens.List;
      list.items.forEach((item, itemIndex) => {
        nodes.push(
          <Fragment key={`${key}-${itemIndex}`}>
            {'• '}
            {renderExcerptBlocks(item.tokens, `${key}-${itemIndex}`)}
          </Fragment>,
        );
      });
      return;
    }

    if (token.type === 'blockquote') {
      nodes.push(...renderExcerptBlocks((token as Tokens.Blockquote).tokens, key));
      return;
    }

    // paragraph, text, and anything else carrying inline children: render inline, then a
    // separating space, so the next block doesn't run directly into this one's last word.
    const inline = childTokensOf(token);
    if (inline.length > 0) {
      nodes.push(<Fragment key={key}>{renderInline(inline, key)} </Fragment>);
    }
  });
  return nodes;
}

/** Props for {@link ExcerptMarkdown}. */
export interface ExcerptMarkdownProps {
  /** A Markdown excerpt, already cut to preview length. */
  readonly value: string;
  readonly className?: string;
}

/**
 * Render a Markdown excerpt as one flowing, clampable line of formatted text.
 *
 * @returns The rendered excerpt.
 */
export function ExcerptMarkdown({ value, className }: ExcerptMarkdownProps): JSX.Element {
  const tokens = useMemo(() => marked.lexer(value, { gfm: true, breaks: false }), [value]);
  return <p className={className}>{renderExcerptBlocks(tokens, 'excerpt')}</p>;
}
