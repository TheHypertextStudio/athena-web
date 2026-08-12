'use client';

/**
 * The `/` insert menu — every block a person can create without knowing Markdown.
 *
 * @remarks
 * Markdown shortcuts already work in these editors (`# ` makes a heading, `- ` a bullet), but
 * they only help someone who already knows them. `/` is the discoverable path to the same
 * blocks: type it on an empty line, read the list, pick one. The two must stay in step, so each
 * entry below runs the *same* Tiptap command the Markdown shortcut runs rather than inserting
 * literal syntax — there is one way to make a heading, reachable two ways.
 *
 * Choosing an entry replaces the typed `/query` and leaves the caret inside the new block, so
 * the next keystroke is content. That is the difference between an insert menu and a menu that
 * makes you clean up after it.
 */
import type { Editor } from '@tiptap/react';

import {
  Code,
  Divider,
  FormatQuote,
  Heading,
  ListBulleted,
  ListChecks,
  ListOrdered,
  type LucideIcon,
} from '@docket/ui/icons';

/** One entry in the `/` menu. */
export interface SlashCommand {
  /** Stable id, also the React key. */
  readonly id: string;
  /** The row's label. */
  readonly label: string;
  /** A quieter second line saying what the block is for. */
  readonly hint: string;
  /** Extra words that should match the row (e.g. "bullet" for an unordered list). */
  readonly keywords: readonly string[];
  /** The glyph in the leading slot. */
  readonly icon: LucideIcon;
  /** Replace `[from, to)` with the block and leave the caret inside it. */
  readonly run: (editor: Editor, range: { from: number; to: number }) => void;
}

/** Delete the typed `/query` first, so no command has to remember to. */
function replacing(
  editor: Editor,
  range: { from: number; to: number },
): ReturnType<Editor['chain']> {
  return editor.chain().focus().deleteRange(range);
}

/**
 * Every `/` command, in menu order.
 *
 * @remarks
 * Ordered by how often a person reaches for it while writing a brief, not alphabetically:
 * headings structure a document, lists carry its content, and the rarer blocks follow.
 */
export const SLASH_COMMANDS: readonly SlashCommand[] = [
  {
    id: 'heading-1',
    label: 'Heading 1',
    hint: 'A section title',
    keywords: ['h1', 'title', 'heading'],
    icon: Heading,
    run: (editor, range) => {
      replacing(editor, range).setNode('heading', { level: 1 }).run();
    },
  },
  {
    id: 'heading-2',
    label: 'Heading 2',
    hint: 'A subsection title',
    keywords: ['h2', 'heading'],
    icon: Heading,
    run: (editor, range) => {
      replacing(editor, range).setNode('heading', { level: 2 }).run();
    },
  },
  {
    id: 'heading-3',
    label: 'Heading 3',
    hint: 'A minor heading',
    keywords: ['h3', 'heading'],
    icon: Heading,
    run: (editor, range) => {
      replacing(editor, range).setNode('heading', { level: 3 }).run();
    },
  },
  {
    id: 'bullet-list',
    label: 'Bulleted list',
    hint: 'An unordered list',
    keywords: ['bullet', 'unordered', 'ul', 'list'],
    icon: ListBulleted,
    run: (editor, range) => {
      replacing(editor, range).toggleBulletList().run();
    },
  },
  {
    id: 'ordered-list',
    label: 'Numbered list',
    hint: 'A list in sequence',
    keywords: ['ordered', 'number', 'ol', 'list'],
    icon: ListOrdered,
    run: (editor, range) => {
      replacing(editor, range).toggleOrderedList().run();
    },
  },
  {
    id: 'task-list',
    label: 'Checklist',
    hint: 'Items you can tick off',
    keywords: ['todo', 'task', 'check', 'checkbox', 'list'],
    icon: ListChecks,
    run: (editor, range) => {
      replacing(editor, range).toggleTaskList().run();
    },
  },
  {
    id: 'quote',
    label: 'Quote',
    hint: "Set apart someone else's words",
    keywords: ['blockquote', 'citation'],
    icon: FormatQuote,
    run: (editor, range) => {
      replacing(editor, range).toggleBlockquote().run();
    },
  },
  {
    id: 'code-block',
    label: 'Code block',
    hint: 'Preformatted, monospaced',
    keywords: ['code', 'snippet', 'pre'],
    icon: Code,
    run: (editor, range) => {
      replacing(editor, range).setNode('codeBlock').run();
    },
  },
  {
    id: 'divider',
    label: 'Divider',
    hint: 'A horizontal rule between sections',
    keywords: ['hr', 'rule', 'separator', 'line'],
    icon: Divider,
    run: (editor, range) => {
      replacing(editor, range).setHorizontalRule().run();
    },
  },
];

/**
 * Filter the `/` commands against a typed query.
 *
 * @param query - What was typed after the slash.
 * @returns The matching commands, in menu order.
 */
export function rankSlashCommands(query: string): readonly SlashCommand[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter(
    (command) =>
      command.label.toLowerCase().includes(needle) ||
      command.keywords.some((keyword) => keyword.startsWith(needle)),
  );
}
