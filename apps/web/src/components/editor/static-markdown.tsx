'use client';

import { cn } from '@docket/ui/lib/utils';
import { Marked, type TokenizerAndRendererExtension } from 'marked';
import type { JSX } from 'react';
import { useMemo } from 'react';

import { renderBlocks } from './render-markdown-tokens';

/**
 * `++text++` — the underline syntax `@tiptap/markdown` serializes the Underline mark to.
 *
 * @remarks
 * Markdown has no underline, so every editor that supports one invents a spelling. Docket's bodies
 * are written by Tiptap, which writes `++…++`, and this reader has to understand exactly what that
 * writer produces or an underlined phrase would come back as literal plus signs the moment it left
 * the editor. Symmetry with the writer is the whole requirement; the specific characters are not a
 * choice this module gets to make.
 */
const underlineExtension: TokenizerAndRendererExtension = {
  name: 'underline',
  level: 'inline',
  start: (src) => src.indexOf('++'),
  tokenizer(src) {
    // Requires content that neither starts nor ends with whitespace, and a closing pair — so a
    // stray `++` (a diff header, a C idiom) is left as the text it is.
    const match = /^\+\+(?=\S)([\s\S]*?\S)\+\+/.exec(src);
    if (match === null) return undefined;
    const text = match[1] ?? '';
    return { type: 'underline', raw: match[0], text, tokens: this.lexer.inlineTokens(text) };
  },
};

/**
 * A private `marked` instance, so registering the underline rule cannot reach anyone else.
 *
 * @remarks
 * `marked`'s default export is a shared singleton, and `@tiptap/markdown` reaches for that same
 * singleton when no instance is passed to it. Calling `marked.use()` here would therefore reach
 * into the editor's parser too and collide with the underline tokenizer Tiptap registers there.
 */
const staticMarked = new Marked().use({ extensions: [underlineExtension] });

/** Props for the lightweight persisted-Markdown renderer. */
export interface StaticMarkdownProps {
  /** Persisted Markdown source. */
  value: string;
  /** Additional wrapper styling. */
  className?: string;
}

/**
 * Typography, code-highlight token colors, and GFM checklist/table layout for
 * {@link StaticMarkdown}'s content — kept as one Tailwind arbitrary-variant string, matching
 * {@link file://./freeform-text.tsx}'s editable surface so the same Markdown renders identically
 * whether it's being edited or has already been posted (e.g. a comment).
 */
const STATIC_MARKDOWN_CONTENT_CLASS =
  "text-on-surface text-body-medium [&_a]:text-primary [&_blockquote]:border-outline-variant [&_[data-inline-code]]:border-outline-variant [&_[data-inline-code]]:bg-surface-container-high [&_.hljs-keyword]:text-primary [&_.hljs-built_in]:text-primary [&_.hljs-type]:text-primary [&_.hljs-selector-tag]:text-primary [&_.hljs-title]:text-secondary [&_.hljs-function]:text-secondary [&_.hljs-section]:text-secondary [&_.hljs-string]:text-tertiary [&_.hljs-attr]:text-tertiary [&_.hljs-addition]:text-tertiary [&_.hljs-number]:text-secondary [&_.hljs-literal]:text-secondary [&_.hljs-symbol]:text-secondary [&_.hljs-comment]:text-on-surface-variant [&_.hljs-quote]:text-on-surface-variant [&_.hljs-meta]:text-on-surface-variant [&_.hljs-deletion]:text-error [&_h1]:text-title-large [&_h2]:text-title-large [&_h3]:text-title-medium [&_td]:border-outline-variant [&_th]:border-outline-variant max-w-[75ch] [&_[data-inline-code]]:rounded [&_[data-inline-code]]:border [&_[data-inline-code]]:px-1.5 [&_[data-inline-code]]:py-0.5 [&_[data-inline-code]]:font-mono [&_a]:underline [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_h1]:mt-6 [&_h2]:mt-5 [&_h3]:mt-4 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_table]:min-w-full [&_td]:border-b [&_td]:p-2 [&_th]:border-b [&_th]:p-2 [&_img]:my-3 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-lg [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul[data-type='taskList']]:my-2 [&_ul[data-type='taskList']]:list-none [&_ul[data-type='taskList']]:pl-0 [&_ul[data-type='taskList']_ul[data-type='taskList']]:my-0 [&_ul[data-type='taskList']_ul[data-type='taskList']]:pl-6 [&_li[data-type='taskItem']]:flex [&_li[data-type='taskItem']]:items-start [&_li[data-type='taskItem']]:gap-2 [&_li[data-type='taskItem']]:my-1 [&_li[data-type='taskItem']>label]:relative [&_li[data-type='taskItem']>label]:mt-0.5 [&_li[data-type='taskItem']>label]:flex [&_li[data-type='taskItem']>label]:shrink-0 [&_li[data-type='taskItem']>div]:min-w-0 [&_li[data-type='taskItem']>div]:flex-1 [&_li[data-type='taskItem']>div_p]:my-0 [&_li[data-type='taskItem'][data-checked='true']>div]:text-on-surface-variant [&_li[data-type='taskItem'][data-checked='true']>div]:line-through [&>*:first-child]:mt-0 [&>*:last-child]:mb-0";

/** Render persisted Markdown without mounting an editor or executing embedded HTML. */
export function StaticMarkdown({ value, className }: StaticMarkdownProps): JSX.Element {
  const tokens = useMemo(() => staticMarked.lexer(value, { gfm: true, breaks: false }), [value]);
  return (
    <div data-static-markdown="" className={cn(STATIC_MARKDOWN_CONTENT_CLASS, className)}>
      {renderBlocks(tokens)}
    </div>
  );
}
