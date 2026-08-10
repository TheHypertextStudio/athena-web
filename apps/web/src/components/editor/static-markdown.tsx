'use client';

import { cn } from '@docket/ui/lib/utils';
import { marked, type Token, type Tokens } from 'marked';
import type { JSX, ReactNode } from 'react';
import { Fragment, useEffect, useMemo, useState } from 'react';

import { CodeBlockFrame } from './code-block-frame';
import { codeLanguageLoader } from './code-language-loader';

type HighlightTree = NonNullable<ReturnType<typeof codeLanguageLoader.highlight>>;
type HighlightNode = HighlightTree['children'][number];

/** Props for the lightweight persisted-Markdown renderer. */
export interface StaticMarkdownProps {
  /** Persisted Markdown source. */
  value: string;
  /** Additional wrapper styling. */
  className?: string;
}

function safeHref(href: string): string | undefined {
  return /^(https?:|mailto:|\/|#)/i.test(href) ? href : undefined;
}

function renderHighlightNode(node: HighlightNode, key: string): ReactNode {
  if (node.type === 'text') return node.value;
  if (node.type !== 'element') return null;
  const classes = Array.isArray(node.properties.className)
    ? node.properties.className.filter((value): value is string => typeof value === 'string')
    : [];
  return (
    <span key={key} className={classes.join(' ')}>
      {node.children.map((child, index) => renderHighlightNode(child, `${key}-${index}`))}
    </span>
  );
}

/** Highlight one static code block after its exact grammar chunk settles. */
function StaticCode({ language, value }: { language: string; value: string }): JSX.Element {
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    void codeLanguageLoader.ensure(language).then(() => {
      if (active) setRevision((current) => current + 1);
    });
    return () => {
      active = false;
    };
  }, [language]);

  const tree = useMemo(
    () => codeLanguageLoader.highlight(language, value),
    [language, value, revision],
  );
  return (
    <CodeBlockFrame code={value} language={language}>
      <code style={{ whiteSpace: 'pre' }}>
        {tree?.children.map((node, index) => renderHighlightNode(node, String(index))) ?? value}
      </code>
    </CodeBlockFrame>
  );
}

function renderInline(tokens: readonly Token[], prefix: string): ReactNode[] {
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

function renderBlocks(tokens: readonly Token[], prefix = 'block'): ReactNode[] {
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
      case 'list': {
        const list = token as Tokens.List;
        const items = list.items.map((item, itemIndex) => (
          <li key={`${key}-${itemIndex}`}>
            {item.task ? <input type="checkbox" checked={item.checked} readOnly /> : null}
            {renderBlocks(item.tokens, `${key}-${itemIndex}`)}
          </li>
        ));
        return list.ordered ? (
          <ol key={key} start={typeof list.start === 'number' ? list.start : undefined}>
            {items}
          </ol>
        ) : (
          <ul key={key}>{items}</ul>
        );
      }
      case 'table': {
        const table = token as Tokens.Table;
        return (
          <div key={key} className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  {table.header.map((cell, cellIndex) => (
                    <th
                      key={`${key}-head-${cellIndex}`}
                      style={{ textAlign: cell.align ?? 'left' }}
                    >
                      {renderInline(cell.tokens, `${key}-head-${cellIndex}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, rowIndex) => (
                  <tr key={`${key}-row-${rowIndex}`}>
                    {row.map((cell, cellIndex) => (
                      <td
                        key={`${key}-row-${rowIndex}-${cellIndex}`}
                        style={{ textAlign: cell.align ?? 'left' }}
                      >
                        {renderInline(cell.tokens, `${key}-row-${rowIndex}-${cellIndex}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
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

/** Render persisted Markdown without mounting an editor or executing embedded HTML. */
export function StaticMarkdown({ value, className }: StaticMarkdownProps): JSX.Element {
  const tokens = useMemo(() => marked.lexer(value, { gfm: true, breaks: false }), [value]);
  return (
    <div
      data-static-markdown=""
      className={cn(
        'text-on-surface text-body-medium [&_a]:text-primary [&_blockquote]:border-outline-variant [&_[data-inline-code]]:border-outline-variant [&_[data-inline-code]]:bg-surface-container-high [&_.hljs-keyword]:text-primary [&_.hljs-built_in]:text-primary [&_.hljs-type]:text-primary [&_.hljs-selector-tag]:text-primary [&_.hljs-title]:text-secondary [&_.hljs-function]:text-secondary [&_.hljs-section]:text-secondary [&_.hljs-string]:text-tertiary [&_.hljs-attr]:text-tertiary [&_.hljs-addition]:text-tertiary [&_.hljs-number]:text-secondary [&_.hljs-literal]:text-secondary [&_.hljs-symbol]:text-secondary [&_.hljs-comment]:text-on-surface-variant [&_.hljs-quote]:text-on-surface-variant [&_.hljs-meta]:text-on-surface-variant [&_.hljs-deletion]:text-error [&_h1]:text-title-large [&_h2]:text-title-large [&_h3]:text-title-medium [&_td]:border-outline-variant [&_th]:border-outline-variant max-w-[75ch] [&_[data-inline-code]]:rounded [&_[data-inline-code]]:border [&_[data-inline-code]]:px-1.5 [&_[data-inline-code]]:py-0.5 [&_[data-inline-code]]:font-mono [&_a]:underline [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_h1]:mt-6 [&_h2]:mt-5 [&_h3]:mt-4 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_table]:min-w-full [&_td]:border-b [&_td]:p-2 [&_th]:border-b [&_th]:p-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
        className,
      )}
    >
      {renderBlocks(tokens)}
    </div>
  );
}
