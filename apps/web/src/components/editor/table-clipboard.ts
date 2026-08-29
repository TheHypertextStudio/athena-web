'use client';

import type { Editor } from '@tiptap/core';
import { DOMSerializer, Fragment, Slice, type Node as ProseMirrorNode } from '@tiptap/pm/model';

import { serializeSliceToMarkdown } from './markdown-clipboard';

/** Clipboard representations derived from the table containing the current selection. */
export interface TableClipboardPayload {
  /** Rich table markup for document editors and spreadsheets. */
  readonly html: string;
  /** GFM source for Markdown and plain-text destinations. */
  readonly markdown: string;
  /** RFC-style comma-delimited rows for data tools. */
  readonly csv: string;
}

/** Find the table that contains the editor selection. */
function selectedTable(editor: Editor): ProseMirrorNode | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === 'table') return node;
  }
  return null;
}

/** Quote one CSV field only when its contents require it. */
function csvField(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

/** Keep visible atom labels while projecting rich cell content to plain data. */
function cellLeafText(node: ProseMirrorNode): string {
  if (node.type.name === 'hardBreak') return '\n';
  const attrs = node.attrs as unknown;
  if (attrs !== null && typeof attrs === 'object') {
    const values = attrs as Record<string, unknown>;
    const label = values['label'];
    if (typeof label === 'string') return label;
    const alt = values['alt'];
    if (typeof alt === 'string') return alt;
  }
  return node.type.spec.leafText?.(node) ?? '';
}

/**
 * Serialize a table node as comma-delimited rows.
 *
 * @param table - The ProseMirror table node to project as cell values.
 * @returns RFC-style CSV with visible cell breaks retained as quoted newlines.
 */
export function tableToCsv(table: ProseMirrorNode): string {
  const rows: string[] = [];
  table.forEach((row) => {
    const cells: string[] = [];
    row.forEach((cell) => {
      cells.push(csvField(cell.textBetween(0, cell.content.size, '\n', cellLeafText)));
    });
    rows.push(cells.join(','));
  });
  return rows.join('\n');
}

/** Serialize a table node as the rich clipboard fragment. */
function tableHtml(editor: Editor, table: ProseMirrorNode): string {
  const wrapper = document.createElement('div');
  wrapper.appendChild(DOMSerializer.fromSchema(editor.schema).serializeNode(table));
  return wrapper.innerHTML;
}

/**
 * Build every copy format for the table containing the current selection.
 *
 * @param editor - The editor whose current cell identifies the table to copy.
 * @returns The three table representations, or `null` when the selection is outside a table.
 */
export function tableClipboardPayload(editor: Editor): TableClipboardPayload | null {
  const table = selectedTable(editor);
  if (table === null) return null;

  return {
    html: tableHtml(editor, table),
    markdown: serializeSliceToMarkdown(editor, new Slice(Fragment.from(table), 0, 0)),
    csv: tableToCsv(table),
  };
}
