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

import { parseDocumentFigureHtml, type DocumentFigure } from '@docket/markdown-tree';

import Link from '@/components/docket-link';

import { MarkdownTable, MarkdownTaskItem, type MarkdownTableCell } from './markdown-block-parts';
import { StaticCode } from './static-code-block';

/** Allow only the link schemes this renderer is willing to point a real `<a href>` at. */
function safeHref(href: string): string | undefined {
  return /^(https?:|mailto:|\/|#)/i.test(href) ? href : undefined;
}

/**
 * Allow only the sources this renderer is willing to point a real `<img src>` at.
 *
 * @remarks
 * Narrower than {@link safeHref} on purpose. An image source is fetched without the reader doing
 * anything, so the set has to be smaller than the set a reader may choose to *click*: `mailto:` and
 * `#` are meaningless here, and `data:` is excluded so a body cannot carry an arbitrary inline
 * payload past the upload route's raster allowlist.
 *
 * Absolute `https:` stays allowed because Markdown pasted from another tool references that tool's
 * own host. Docket cannot rehost bytes it has no credentials for, so such an image is kept and
 * rendered rather than silently deleted, and simply fails to load for anyone who cannot reach it.
 */
function safeImageSrc(src: string): string | undefined {
  if (src.startsWith('/') && !src.startsWith('//')) return src;
  return /^https:\/\/[^/\s?#]+(?:[/?#][^\s]*)?$/.test(src) ? src : undefined;
}

/** Optional source policy supplied by a surface such as an anonymous public brief. */
export interface MarkdownRenderOptions {
  /** Resolve or rewrite one safe image source before it enters an `img` element. */
  readonly resolveImageSource?: (src: string) => string | undefined;
  /** Render ordinary anchors with the browser alone, for a server-only public document. */
  readonly nativeLinks?: boolean;
}

/** Resolve an image through the caller's stricter policy or the default persisted-Markdown policy. */
function resolvedImageSource(src: string, options: MarkdownRenderOptions): string | undefined {
  return options.resolveImageSource ? options.resolveImageSource(src) : safeImageSrc(src);
}

/** Return whether a figure has visible caption or attribution content. */
function hasFigureCaption(figure: DocumentFigure): boolean {
  return [
    figure.caption,
    figure.creditText,
    figure.sourceUrl,
    figure.licenseText,
    figure.licenseUrl,
  ].some((value) => Boolean(value));
}

/** Render the attribution attached to one codec-owned figure. */
function renderFigureAttribution(figure: DocumentFigure): ReactNode {
  const visible = [figure.creditText, figure.sourceUrl, figure.licenseText, figure.licenseUrl].some(
    (value) => Boolean(value),
  );
  if (!visible) return null;
  let license: ReactNode = null;
  if (figure.licenseUrl) {
    license = (
      <a href={figure.licenseUrl} target="_blank" rel="license noreferrer" itemProp="license">
        {figure.licenseText ?? 'License'}
      </a>
    );
  } else if (figure.licenseText) {
    license = <span itemProp="license">{figure.licenseText}</span>;
  }
  return (
    <span data-docket-attribution="">
      {figure.creditText ? <span itemProp="creditText">{figure.creditText}</span> : null}
      {figure.sourceUrl ? (
        <a href={figure.sourceUrl} target="_blank" rel="noreferrer">
          Source
        </a>
      ) : null}
      {license}
    </span>
  );
}

/** Render one parsed codec-owned figure without trusting its original HTML string. */
function renderFigure(
  figure: DocumentFigure,
  key: string,
  options: MarkdownRenderOptions,
): ReactNode {
  const src = resolvedImageSource(figure.src, options);
  if (!src) return <p key={key}>{figure.alt}</p>;
  return (
    <figure
      key={key}
      data-docket-figure="1"
      data-decorative={String(figure.decorative)}
      itemScope
      itemType="https://schema.org/ImageObject"
    >
      <img src={src} alt={figure.decorative ? '' : figure.alt} itemProp="contentUrl" />
      {hasFigureCaption(figure) ? (
        <figcaption>
          {figure.caption ? <span itemProp="caption">{figure.caption}</span> : null}
          {renderFigureAttribution(figure)}
        </figcaption>
      ) : null}
    </figure>
  );
}

/** Render one ordinary Markdown link under the surface's navigation policy. */
function renderLinkToken(
  link: Tokens.Link,
  key: string,
  options: MarkdownRenderOptions,
): ReactNode {
  const href = safeHref(link.href);
  const content = renderInline(link.tokens, key, options);
  if (href === undefined) return <Fragment key={key}>{content}</Fragment>;
  if (options.nativeLinks) {
    return (
      <a key={key} href={href} title={link.title ?? undefined} data-native-navigation="">
        {content}
      </a>
    );
  }
  return (
    <Link key={key} href={href} title={link.title ?? undefined}>
      {content}
    </Link>
  );
}

/** Render one legacy Markdown image without widening the semantic-figure source policy. */
function renderLegacyImageToken(
  image: Tokens.Image,
  key: string,
  options: MarkdownRenderOptions,
): ReactNode {
  const src = resolvedImageSource(image.href, options);
  if (src === undefined) return <Fragment key={key}>{image.text}</Fragment>;
  return <img key={key} src={src} alt={image.text} title={image.title ?? undefined} />;
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
export function renderInline(
  tokens: readonly Token[],
  prefix: string,
  options: MarkdownRenderOptions = {},
): ReactNode[] {
  return tokens.map((token, index) => {
    const key = `${prefix}-${index}`;
    switch (token.type) {
      case 'text': {
        const text = token as Tokens.Text;
        return (
          <Fragment key={key}>
            {text.tokens ? renderInline(text.tokens, key, options) : text.text}
          </Fragment>
        );
      }
      case 'escape':
        return <Fragment key={key}>{(token as Tokens.Escape).text}</Fragment>;
      case 'strong':
        return (
          <strong key={key}>{renderInline((token as Tokens.Strong).tokens, key, options)}</strong>
        );
      case 'em':
        return <em key={key}>{renderInline((token as Tokens.Em).tokens, key, options)}</em>;
      case 'del':
        return <del key={key}>{renderInline((token as Tokens.Del).tokens, key, options)}</del>;
      case 'codespan':
        return (
          <code key={key} data-inline-code="">
            {(token as Tokens.Codespan).text}
          </code>
        );
      case 'br':
        return <br key={key} />;
      case 'link': {
        return renderLinkToken(token as Tokens.Link, key, options);
      }
      case 'underline':
        // Not standard Markdown — `++text++` is the syntax `@tiptap/markdown`'s Underline mark
        // serializes to, so the reader must understand exactly what the editor writes.
        return (
          <u key={key}>
            {token.tokens ? renderInline(token.tokens, key, options) : String(token['text'] ?? '')}
          </u>
        );
      case 'image': {
        // No safe source means alt text instead of a request to an authored address.
        return renderLegacyImageToken(token as Tokens.Image, key, options);
      }
      case 'html':
        return <Fragment key={key}>{(token as Tokens.HTML).text}</Fragment>;
      default: {
        const generic = token as Tokens.Generic;
        return (
          <Fragment key={key}>
            {generic.tokens
              ? renderInline(generic.tokens, key, options)
              : String(generic['text'] ?? '')}
          </Fragment>
        );
      }
    }
  });
}

/** Render one GFM list into its `<ul>`/`<ol>`, rendering task items as real checkboxes. */
function renderList(list: Tokens.List, key: string, options: MarkdownRenderOptions): ReactNode {
  // GFM allows mixing plain and task items in one list, so only mark the `<ul>` itself as a
  // checklist (which drops its bullet/indent) when every item is a task. A mixed list keeps its
  // normal bullet styling; task items among them still get their own checkbox layout, since that
  // comes from `li[data-checked]` on the item itself, independent of the `<ul>`'s attribute.
  const isTaskList = list.items.every((item) => item.task);
  const items = list.items.map((item, itemIndex) => {
    const itemKey = `${key}-${itemIndex}`;
    const content = renderBlocks(item.tokens, itemKey, options);
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
function renderTable(table: Tokens.Table, key: string, options: MarkdownRenderOptions): ReactNode {
  const toCell = (cell: Tokens.TableCell, cellKey: string): MarkdownTableCell => ({
    content: renderInline(cell.tokens, cellKey, options),
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
 * @remarks
 * This is one of three places that walk a Markdown token tree with their own opinion on which
 * block shapes to handle: this one (a full document, every block becomes its own real DOM element
 * — `<ul>`/`<ol>` with real `<li>`s, a real `<table>`), `apps/web/src/components/mentions/excerpt-markdown.tsx`
 * (a reduced-fidelity single-line excerpt), and `apps/api/src/content/markdown-links.ts`'s
 * `collectPlainText` (a fully flattened plain-text excerpt). The latter two share their
 * token-walking primitives via `@docket/markdown-tree`; this one doesn't, on purpose — it needs
 * typed access to `list.items`/`table.header`/`table.rows` to build real structured markup, not
 * the flattened-into-one-array view `childTokensOf` gives the other two. A change to which block
 * shapes exist, or how one should be handled, is still worth checking against the other two.
 *
 * @param tokens - Block-level tokens, typically the direct output of `marked.lexer`.
 * @param prefix - A key namespace for this call, so nested lists/blockquotes don't collide with
 * their siblings' React keys.
 * @returns One React node per top-level token, in source order.
 */
export function renderBlocks(
  tokens: readonly Token[],
  prefix = 'block',
  options: MarkdownRenderOptions = {},
): ReactNode[] {
  return tokens.map((token, index) => {
    const key = `${prefix}-${index}`;
    switch (token.type) {
      case 'space':
      case 'def':
        return null;
      case 'paragraph':
        return <p key={key}>{renderInline((token as Tokens.Paragraph).tokens, key, options)}</p>;
      case 'heading': {
        const heading = token as Tokens.Heading;
        const content = renderInline(heading.tokens, key, options);
        if (heading.depth === 1) return <h1 key={key}>{content}</h1>;
        if (heading.depth === 2) return <h2 key={key}>{content}</h2>;
        return <h3 key={key}>{content}</h3>;
      }
      case 'blockquote':
        return (
          <blockquote key={key}>
            {renderBlocks((token as Tokens.Blockquote).tokens, key, options)}
          </blockquote>
        );
      case 'code': {
        const code = token as Tokens.Code;
        return <StaticCode key={key} language={code.lang?.trim() ?? ''} value={code.text} />;
      }
      case 'hr':
        return <hr key={key} />;
      case 'list':
        return renderList(token as Tokens.List, key, options);
      case 'table':
        return renderTable(token as Tokens.Table, key, options);
      case 'html': {
        const html = token as Tokens.HTML;
        const figure = parseDocumentFigureHtml(html.raw);
        return figure ? renderFigure(figure, key, options) : <p key={key}>{html.text}</p>;
      }
      case 'text': {
        const text = token as Tokens.Text;
        return <p key={key}>{text.tokens ? renderInline(text.tokens, key, options) : text.text}</p>;
      }
      default: {
        const generic = token as Tokens.Generic;
        return generic.tokens ? (
          <Fragment key={key}>{renderBlocks(generic.tokens, key, options)}</Fragment>
        ) : null;
      }
    }
  });
}
