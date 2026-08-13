/**
 * Turns `marked`'s Markdown tokens into React elements.
 *
 * @remarks
 * Kept apart from {@link StaticMarkdown} (the component that owns styling and the top-level
 * container) so the token-walking logic — the part that changes when Markdown syntax support
 * changes — can be read, tested, and modified without wading through layout/CSS concerns.
 */
import type { Token, Tokens } from 'marked';
import type { ReactNode } from 'react';
import { Fragment } from 'react';

import { MarkdownTable, MarkdownTaskItem, type MarkdownTableCell } from './markdown-block-parts';
import { StaticCode } from './static-code-block';

/** Allow only the link schemes this renderer is willing to point a real `<a href>` at. */
function safeHref(href: string): string | undefined {
  return /^(https?:|mailto:|\/|#)/i.test(href) ? href : undefined;
}

/**
 * Render one token's inline (span-level) children — text, emphasis, links, code spans, etc.
 *
 * @remarks
 * Exported so {@link ExcerptMarkdown} (`../mentions/excerpt-markdown`) can reuse the exact same
 * emphasis/link/code handling for a preview excerpt, rather than a second hand-rolled copy: the
 * two renderers differ only in which *block* shapes they allow (a full document's `<h1>`/`<table>`
 * vs. a hovercard excerpt's single flowing line), never in how a `**bold**` or a `[link](url)`
 * becomes a React node.
 */
export function renderInline(tokens: readonly Token[], prefix: string): ReactNode[] {
  return tokens.map((token, index) => {
    const key = `${prefix}-${index}`;
    switch (token.type) {
      case 'text': {
        const text = token as Tokens.Text;
        return (
          <Fragment key={key}>{text.tokens ? renderInline(text.tokens, key) : text.text}</Fragment>
        );
      }
      case 'escape':
        return <Fragment key={key}>{(token as Tokens.Escape).text}</Fragment>;
      case 'strong':
        return <strong key={key}>{renderInline((token as Tokens.Strong).tokens, key)}</strong>;
      case 'em':
        return <em key={key}>{renderInline((token as Tokens.Em).tokens, key)}</em>;
      case 'del':
        return <del key={key}>{renderInline((token as Tokens.Del).tokens, key)}</del>;
      case 'codespan':
        return (
          <code key={key} data-inline-code="">
            {(token as Tokens.Codespan).text}
          </code>
        );
      case 'br':
        return <br key={key} />;
      case 'link': {
        const link = token as Tokens.Link;
        const href = safeHref(link.href);
        const content = renderInline(link.tokens, key);
        return href === undefined ? (
          <Fragment key={key}>{content}</Fragment>
        ) : (
          <a key={key} href={href} title={link.title ?? undefined}>
            {content}
          </a>
        );
      }
      case 'image':
        return <Fragment key={key}>{(token as Tokens.Image).text}</Fragment>;
      case 'html':
        return <Fragment key={key}>{(token as Tokens.HTML).text}</Fragment>;
      default: {
        const generic = token as Tokens.Generic;
        return (
          <Fragment key={key}>
            {generic.tokens ? renderInline(generic.tokens, key) : String(generic['text'] ?? '')}
          </Fragment>
        );
      }
    }
  });
}

/** Render one GFM list into its `<ul>`/`<ol>`, rendering task items as real checkboxes. */
function renderList(list: Tokens.List, key: string): ReactNode {
  // GFM allows mixing plain and task items in one list, so only mark the `<ul>` itself as a
  // checklist (which drops its bullet/indent) when every item is a task. A mixed list keeps its
  // normal bullet styling; task items among them still get their own checkbox layout, since that
  // comes from `li[data-checked]` on the item itself, independent of the `<ul>`'s attribute.
  const isTaskList = list.items.every((item) => item.task);
  const items = list.items.map((item, itemIndex) => {
    const itemKey = `${key}-${itemIndex}`;
    const content = renderBlocks(item.tokens, itemKey);
    return item.task ? (
      <MarkdownTaskItem key={itemKey} checked={item.checked ?? false}>
        {content}
      </MarkdownTaskItem>
    ) : (
      <li key={itemKey}>{content}</li>
    );
  });
  return list.ordered ? (
    <ol key={key} start={typeof list.start === 'number' ? list.start : undefined}>
      {items}
    </ol>
  ) : (
    <ul key={key} data-type={isTaskList ? 'taskList' : undefined}>
      {items}
    </ul>
  );
}

/** Render one GFM table, pre-rendering each cell's inline content for {@link MarkdownTable}. */
function renderTable(table: Tokens.Table, key: string): ReactNode {
  const toCell = (cell: Tokens.TableCell, cellKey: string): MarkdownTableCell => ({
    content: renderInline(cell.tokens, cellKey),
    align: cell.align,
  });
  return (
    <MarkdownTable
      key={key}
      keyPrefix={key}
      header={table.header.map((cell, index) => toCell(cell, `${key}-head-${index}`))}
      rows={table.rows.map((row, rowIndex) =>
        row.map((cell, cellIndex) => toCell(cell, `${key}-row-${rowIndex}-${cellIndex}`)),
      )}
    />
  );
}

/**
 * Render a token tree from `marked.lexer` into React elements.
 *
 * @param tokens - Block-level tokens, typically the direct output of `marked.lexer`.
 * @param prefix - A key namespace for this call, so nested lists/blockquotes don't collide with
 * their siblings' React keys.
 * @returns One React node per top-level token, in source order.
 */
export function renderBlocks(tokens: readonly Token[], prefix = 'block'): ReactNode[] {
  return tokens.map((token, index) => {
    const key = `${prefix}-${index}`;
    switch (token.type) {
      case 'space':
      case 'def':
        return null;
      case 'paragraph':
        return <p key={key}>{renderInline((token as Tokens.Paragraph).tokens, key)}</p>;
      case 'heading': {
        const heading = token as Tokens.Heading;
        const content = renderInline(heading.tokens, key);
        if (heading.depth === 1) return <h1 key={key}>{content}</h1>;
        if (heading.depth === 2) return <h2 key={key}>{content}</h2>;
        return <h3 key={key}>{content}</h3>;
      }
      case 'blockquote':
        return (
          <blockquote key={key}>
            {renderBlocks((token as Tokens.Blockquote).tokens, key)}
          </blockquote>
        );
      case 'code': {
        const code = token as Tokens.Code;
        return <StaticCode key={key} language={code.lang?.trim() ?? ''} value={code.text} />;
      }
      case 'hr':
        return <hr key={key} />;
      case 'list':
        return renderList(token as Tokens.List, key);
      case 'table':
        return renderTable(token as Tokens.Table, key);
      case 'html':
        return <p key={key}>{(token as Tokens.HTML).text}</p>;
      case 'text': {
        const text = token as Tokens.Text;
        return <p key={key}>{text.tokens ? renderInline(text.tokens, key) : text.text}</p>;
      }
      default: {
        const generic = token as Tokens.Generic;
        return generic.tokens ? (
          <Fragment key={key}>{renderBlocks(generic.tokens, key)}</Fragment>
        ) : null;
      }
    }
  });
}
