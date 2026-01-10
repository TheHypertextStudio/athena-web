/**
 * Markdown content renderer for the assistant.
 *
 * Uses react-markdown with GFM support and syntax highlighting.
 *
 * @packageDocumentation
 */

'use client';

import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { cn } from '@/lib/utils';

/**
 * Props for AssistantMarkdownContent.
 */
export interface AssistantMarkdownContentProps {
  /** The markdown content to render */
  content: string;
  /** Additional class names */
  className?: string;
}

/**
 * Renders markdown content with proper styling.
 *
 * Features:
 * - GitHub Flavored Markdown (tables, strikethrough, etc.)
 * - Syntax highlighting for code blocks
 * - Consistent styling with the design system
 *
 * @example
 * ```tsx
 * <AssistantMarkdownContent content="**Hello** world!" />
 * ```
 */
export const AssistantMarkdownContent = memo(function AssistantMarkdownContent({
  content,
  className,
}: AssistantMarkdownContentProps) {
  return (
    <div className={cn('prose prose-sm dark:prose-invert max-w-none', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          // Custom styling for code blocks
          pre: ({ children, ...props }) => (
            <pre
              className={cn(
                'bg-surface-container-highest rounded-lg p-3',
                'overflow-x-auto text-sm',
              )}
              {...props}
            >
              {children}
            </pre>
          ),
          // Custom styling for inline code
          code: ({ className: codeClassName, children, ...props }) => {
            // Check if this is inside a pre (code block) or inline
            const isInline = !codeClassName?.includes('language-');

            if (isInline) {
              return (
                <code
                  className={cn(
                    'bg-surface-container-highest text-on-surface',
                    'rounded px-1 py-0.5 font-mono text-sm',
                  )}
                  {...props}
                >
                  {children}
                </code>
              );
            }

            return (
              <code className={codeClassName} {...props}>
                {children}
              </code>
            );
          },
          // Custom link styling
          a: ({ children, ...props }) => (
            <a
              className="text-primary underline hover:no-underline"
              target="_blank"
              rel="noopener noreferrer"
              {...props}
            >
              {children}
            </a>
          ),
          // Custom list styling
          ul: ({ children, ...props }) => (
            <ul className="my-2 list-disc pl-4" {...props}>
              {children}
            </ul>
          ),
          ol: ({ children, ...props }) => (
            <ol className="my-2 list-decimal pl-4" {...props}>
              {children}
            </ol>
          ),
          // Custom paragraph styling
          p: ({ children, ...props }) => (
            <p className="mb-2 last:mb-0" {...props}>
              {children}
            </p>
          ),
          // Custom heading styling
          h1: ({ children, ...props }) => (
            <h1 className="mt-4 mb-2 text-lg font-bold first:mt-0" {...props}>
              {children}
            </h1>
          ),
          h2: ({ children, ...props }) => (
            <h2 className="mt-3 mb-2 text-base font-bold first:mt-0" {...props}>
              {children}
            </h2>
          ),
          h3: ({ children, ...props }) => (
            <h3 className="mt-2 mb-1 text-sm font-bold first:mt-0" {...props}>
              {children}
            </h3>
          ),
          // Custom blockquote styling
          blockquote: ({ children, ...props }) => (
            <blockquote
              className={cn(
                'border-outline my-2 border-l-2 pl-3',
                'text-on-surface-variant italic',
              )}
              {...props}
            >
              {children}
            </blockquote>
          ),
          // Custom table styling
          table: ({ children, ...props }) => (
            <div className="my-2 overflow-x-auto">
              <table className="min-w-full border-collapse text-sm" {...props}>
                {children}
              </table>
            </div>
          ),
          th: ({ children, ...props }) => (
            <th
              className={cn(
                'border-outline-variant border px-2 py-1',
                'bg-surface-container text-left font-medium',
              )}
              {...props}
            >
              {children}
            </th>
          ),
          td: ({ children, ...props }) => (
            <td className="border-outline-variant border px-2 py-1" {...props}>
              {children}
            </td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
