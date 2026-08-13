/**
 * `lib/clipboard/html-to-markdown` — reading Markdown back out of rendered Markdown.
 *
 * @remarks
 * Most of Docket's prose is *read* without an editor: a posted comment is walked from `marked`
 * tokens straight into React elements, which keeps a page of comments cheap. This walker gives that
 * rendered prose a Markdown serializer by reading its DOM back.
 *
 * Its input is always markup this app produced, from the closed set of elements
 * {@link ../../components/editor/render-markdown-tokens} emits. That closed set is what keeps the
 * walker small enough to be obviously correct, and unknown elements degrade to their children.
 *
 * It works from a selection's cloned fragment, which is what makes a *partial* selection come out
 * right: selecting the middle two bullets of a list copies two bullets.
 *
 * @see {@link ../../components/clipboard/clipboard-provider} for the listener that calls this.
 */

/** Elements that begin a new block, and so end whatever inline run preceded them. */
const BLOCK_TAGS = new Set([
  'P',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'UL',
  'OL',
  'LI',
  'BLOCKQUOTE',
  'PRE',
  'TABLE',
  'HR',
  'DIV',
  'FIGURE',
]);

/**
 * Escape the characters that would otherwise be read back as syntax.
 *
 * @remarks
 * A short list, holding only the characters that reliably change meaning. GFM leaves an underscore
 * inside a word alone, so `snake_case_name` survives as written.
 *
 * @param value - Raw text content.
 * @returns The text, safe to place in a Markdown document.
 */
function escapeText(value: string): string {
  return value.replace(/([\\`*[\]])/g, '\\$1');
}

/** Collapse the whitespace an HTML renderer introduced but Markdown should not carry. */
function normalizeWhitespace(value: string): string {
  return value.replace(/[\t\n\r ]+/g, ' ');
}

/**
 * Prefix every line of a block, for blockquotes and nested list content.
 *
 * @remarks
 * Blank lines take their own prefix, and the two containers want different ones. Indenting a blank
 * line inside a list item leaves two trailing spaces, which Markdown reads as a hard line break, so
 * it gets `''`. A blank line inside a blockquote keeps the quote open only while it carries the
 * marker, so it gets `'>'`.
 *
 * @param value - The block's Markdown.
 * @param first - Prefix for the first line.
 * @param rest - Prefix for subsequent non-blank lines.
 * @param blank - Prefix for blank lines.
 * @returns The prefixed block.
 */
function prefixLines(value: string, first: string, rest: string, blank: string): string {
  return value
    .split('\n')
    .map((line, index) => {
      if (index === 0) return `${first}${line}`;
      return line === '' ? blank : `${rest}${line}`;
    })
    .join('\n');
}

/** Whether an element is one of our code-block frames, which is serialized as a whole. */
function isCodeBlockFrame(element: Element): boolean {
  return element.hasAttribute('data-code-block');
}

/** Serialize one node's inline (span-level) content. */
function inlineOf(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeText(normalizeWhitespace(node.nodeValue ?? ''));
  }
  if (!(node instanceof Element)) return '';

  const children = (): string => Array.from(node.childNodes).map(inlineOf).join('');

  switch (node.tagName) {
    case 'BR':
      // Two trailing spaces is the hard break that survives a re-parse.
      return '  \n';
    case 'STRONG':
    case 'B':
      return `**${children()}**`;
    case 'EM':
    case 'I':
      return `*${children()}*`;
    case 'DEL':
    case 'S':
      return `~~${children()}~~`;
    case 'U':
      // Matches what the editor writes; see the underline extension in `static-markdown`.
      return `++${children()}++`;
    case 'CODE':
      // A code span's content is data, so it is taken as text with nothing escaped inside it.
      return `\`${node.textContent}\``;
    case 'IMG': {
      const src = node.getAttribute('src') ?? '';
      return `![${escapeText(node.getAttribute('alt') ?? '')}](${src})`;
    }
    case 'A': {
      const href = node.getAttribute('href');
      return href === null || href === '' ? children() : `[${children()}](${href})`;
    }
    default:
      return children();
  }
}

/** Serialize a list into its Markdown items, indenting anything nested inside them. */
function listOf(element: Element): string {
  const ordered = element.tagName === 'OL';
  const start = Number.parseInt(element.getAttribute('start') ?? '1', 10);
  const first = Number.isFinite(start) && start > 0 ? start : 1;

  const items = Array.from(element.children).filter((child) => child.tagName === 'LI');
  return items
    .map((item, index) => {
      const task = item.getAttribute('data-type') === 'taskItem';
      const marker = ordered
        ? `${String(first + index)}. `
        : task
          ? item.getAttribute('data-checked') === 'true'
            ? '- [x] '
            : '- [ ] '
          : '- ';
      // A task item wraps its prose in a `<div>` beside the checkbox `<label>`, so that div is the
      // content and the checkbox stays out of the text.
      const content = task ? (item.querySelector(':scope > div') ?? item) : item;
      const body = blocksOf(content);
      return prefixLines(body, marker, ' '.repeat(marker.length), '');
    })
    .join('\n');
}

/** Serialize a GFM table, taking each cell's alignment from the style the renderer applied. */
function tableOf(element: Element): string {
  const rows = Array.from(element.querySelectorAll('tr'));
  if (rows.length === 0) return '';

  const cellsOf = (row: Element): readonly Element[] =>
    Array.from(row.children).filter((cell) => cell.tagName === 'TH' || cell.tagName === 'TD');
  const textOf = (cell: Element): string =>
    Array.from(cell.childNodes).map(inlineOf).join('').trim().replaceAll('|', '\\|');

  const [headerRow, ...bodyRows] = rows;
  if (headerRow === undefined) return '';
  const header = cellsOf(headerRow);

  const divider = header.map((cell) => {
    const align = cell instanceof HTMLElement ? cell.style.textAlign : '';
    if (align === 'center') return ':---:';
    if (align === 'right') return '---:';
    return '---';
  });

  const line = (cells: readonly Element[]): string => `| ${cells.map(textOf).join(' | ')} |`;
  return [
    line(header),
    `| ${divider.join(' | ')} |`,
    ...bodyRows.map((row) => line(cellsOf(row))),
  ].join('\n');
}

/** Serialize a code block — either one of our frames, or a bare `<pre>`. */
function codeOf(element: Element): string {
  const frame = isCodeBlockFrame(element);
  const language = frame ? (element.getAttribute('data-code-language') ?? '') : '';
  const source = frame ? element.querySelector('pre') : element;
  const code = (source?.textContent ?? '').replace(/\n$/, '');
  return `\`\`\`${language}\n${code}\n\`\`\``;
}

/** Serialize one block-level element. */
function blockOf(element: Element): string {
  if (isCodeBlockFrame(element)) return codeOf(element);

  switch (element.tagName) {
    case 'H1':
    case 'H2':
    case 'H3':
    case 'H4':
    case 'H5':
    case 'H6': {
      const level = Number.parseInt(element.tagName.slice(1), 10);
      return `${'#'.repeat(level)} ${Array.from(element.childNodes).map(inlineOf).join('').trim()}`;
    }
    case 'P':
      return Array.from(element.childNodes).map(inlineOf).join('').trim();
    case 'UL':
    case 'OL':
      return listOf(element);
    case 'BLOCKQUOTE':
      return prefixLines(blocksOf(element), '> ', '> ', '>');
    case 'PRE':
      return codeOf(element);
    case 'TABLE':
      return tableOf(element);
    case 'HR':
      return '---';
    default:
      // A structural wrapper — the table's scroll container, a task item's content div — whose
      // children carry the content.
      return blocksOf(element);
  }
}

/**
 * Serialize a container's children, separating blocks by a blank line.
 *
 * @remarks
 * Loose inline content between blocks is gathered into an implicit paragraph, which is the shape a
 * partial selection routinely arrives in: its cloned fragment begins with a bare text node, because
 * the selection started in the middle of one.
 *
 * @param root - The node whose children to serialize.
 * @returns Markdown for the subtree.
 */
function blocksOf(root: Node): string {
  const parts: string[] = [];
  let inline = '';

  const flush = (): void => {
    const text = inline.trim();
    inline = '';
    if (text !== '') parts.push(text);
  };

  for (const child of Array.from(root.childNodes)) {
    if (child instanceof Element && (BLOCK_TAGS.has(child.tagName) || isCodeBlockFrame(child))) {
      flush();
      const block = blockOf(child);
      if (block.trim() !== '') parts.push(block);
      continue;
    }
    inline += inlineOf(child);
  }
  flush();

  return parts.join('\n\n');
}

/**
 * Convert a fragment of Docket-rendered Markdown back into Markdown.
 *
 * @param root - The node to serialize, typically `range.cloneContents()`.
 * @returns The Markdown source, or `''` when the fragment carries nothing.
 *
 * @example
 * ```ts
 * const markdown = htmlFragmentToMarkdown(selection.getRangeAt(0).cloneContents());
 * ```
 */
export function htmlFragmentToMarkdown(root: Node): string {
  return blocksOf(root)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
