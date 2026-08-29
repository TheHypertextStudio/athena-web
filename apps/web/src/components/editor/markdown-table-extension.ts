import { Extension, type JSONContent } from '@tiptap/core';
import { Table, TableKit, renderTableToMarkdown } from '@tiptap/extension-table';

/** Choose a private-use placeholder that does not occur in the table. */
function unusedPlaceholder(node: JSONContent, character: string): string {
  const source = JSON.stringify(node);
  let placeholder = character;
  while (source.includes(placeholder)) placeholder += character;
  return placeholder;
}

/** Copy JSON-compatible content while protecting table delimiters and cell line boundaries. */
function withMarkdownPlaceholders(
  value: unknown,
  pipePlaceholder: string,
  breakPlaceholder: string,
): unknown {
  if (typeof value === 'string') return value.replaceAll('|', pipePlaceholder);
  if (Array.isArray(value)) {
    return value.map((item) => withMarkdownPlaceholders(item, pipePlaceholder, breakPlaceholder));
  }
  if (value !== null && typeof value === 'object') {
    if ('type' in value && value.type === 'hardBreak') {
      return { type: 'text', text: breakPlaceholder };
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        withMarkdownPlaceholders(item, pipePlaceholder, breakPlaceholder),
      ]),
    );
  }
  return value;
}

const MarkdownTable = Table.extend({
  renderMarkdown: (node, helpers) => {
    const pipePlaceholder = unusedPlaceholder(node, '\uE000');
    const breakPlaceholder = unusedPlaceholder(node, '\uE001');
    const escaped = withMarkdownPlaceholders(
      node,
      pipePlaceholder,
      breakPlaceholder,
    ) as JSONContent;
    return renderTableToMarkdown(escaped, helpers, { cellLineSeparator: breakPlaceholder })
      .replaceAll(pipePlaceholder, '\\|')
      .replaceAll(breakPlaceholder, '<br>');
  },
});

/**
 * Register Tiptap's table behavior with a serializer that keeps literal pipes inside GFM cells.
 *
 * @remarks
 * Tiptap's stock renderer writes a cell containing `a | b` as three Markdown columns. The next
 * parse then drops content. The stock renderer also writes a control byte between cell paragraphs
 * and flattens hard breaks. This kit changes serialization only. It escapes pipes and maps both
 * kinds of visible cell break to `<br>`, which GFM can round-trip inside a cell.
 */
export const MarkdownTableKit = Extension.create({
  name: 'markdownTableKit',
  addExtensions() {
    return [TableKit.configure({ table: false }), MarkdownTable];
  },
});
