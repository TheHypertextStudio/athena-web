import { Editor } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createMarkdownClipboardExtension,
  looksLikeMarkdown,
  serializeSliceToMarkdown,
} from '@/components/editor/markdown-clipboard';

import { installProseMirrorLayoutShims } from './prosemirror-jsdom';

installProseMirrorLayoutShims();

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

/** Build a headless editor holding `value`, with the extensions the app registers. */
function editorWith(value: string): Editor {
  editor = new Editor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit,
      Image,
      Markdown.configure({ markedOptions: { gfm: true, breaks: false } }),
      createMarkdownClipboardExtension({ uploadImage: null }),
    ],
    content: value,
    contentType: 'markdown',
  });
  return editor;
}

/** Serialize the whole document the way a select-all copy would. */
function copyAll(value: string): string {
  const instance = editorWith(value);
  const { doc } = instance.state;
  return serializeSliceToMarkdown(instance, doc.slice(0, doc.content.size));
}

/**
 * The plain flavor is what a copy leaves behind everywhere that is not a rich editor — a chat
 * message, a terminal, a Markdown file, another issue tracker's description box. ProseMirror's
 * default there is `textBetween`, which keeps the words and discards every piece of structure. So
 * what is pinned here is that the structure survives, construct by construct.
 */
describe('copying out of the editor', () => {
  it('keeps a heading a heading', () => {
    expect(copyAll('# Rollout plan')).toBe('# Rollout plan');
  });

  it('keeps bullets, rather than running them into one line', () => {
    expect(copyAll('- One\n- Two')).toBe('- One\n- Two');
  });

  it('keeps checkboxes and their checked state', () => {
    const copied = copyAll('- [x] Flip the flag\n- [ ] Backfill');

    expect(copied).toContain('[x] Flip the flag');
    expect(copied).toContain('[ ] Backfill');
  });

  it('keeps a fenced code block fenced, with its language', () => {
    const copied = copyAll('```ts\nconst x = 1;\n```');

    expect(copied.startsWith('```ts')).toBe(true);
    expect(copied).toContain('const x = 1;');
    expect(copied.trimEnd().endsWith('```')).toBe(true);
  });

  it('keeps inline emphasis and code', () => {
    expect(copyAll('A **bold** and `code` line')).toBe('A **bold** and `code` line');
  });

  it('keeps a link as a link', () => {
    expect(copyAll('See [the plan](https://docket.test/plan)')).toBe(
      'See [the plan](https://docket.test/plan)',
    );
  });

  it('keeps a table a table', () => {
    const copied = copyAll('| Name | Count |\n| --- | --- |\n| Tasks | 3 |');

    // Cells are padded to a common width, which is still GFM and reads better as plain text.
    const [header, divider, row] = copied.split('\n');
    expect(header?.startsWith('| Name')).toBe(true);
    expect(header).toContain('Count');
    expect(divider).toMatch(/^\|[\s-]+\|[\s-]+\|$/);
    expect(row).toContain('Tasks');
    expect(row).toContain('3');
  });

  it('leaves no blank line at either edge of a copied block', () => {
    const copied = copyAll('| Name |\n| --- |\n| Tasks |');

    expect(copied).toBe(copied.trim());
  });

  it('keeps an image reference', () => {
    expect(copyAll('![Chart](/v1/orgs/o/images/i)')).toContain('![Chart](/v1/orgs/o/images/i)');
  });

  it('copies a partial selection without inventing a document around it', () => {
    const instance = editorWith('First paragraph\n\nSecond paragraph');
    const { doc } = instance.state;
    // A few words inside the first paragraph — an inline-only slice, which the top node type
    // will not accept unwrapped.
    const from = doc.resolve(1).pos;
    const copied = serializeSliceToMarkdown(instance, doc.slice(from, from + 5));

    expect(copied).toBe('First');
  });

  it('has nothing to say about an empty slice', () => {
    const instance = editorWith('');
    expect(serializeSliceToMarkdown(instance, instance.state.doc.slice(0, 0))).toBe('');
  });
});

/**
 * The paste heuristic decides whether text is *interpreted* at all. Erring permissive is what turns
 * a pasted paragraph into mangled structure, so both directions are pinned: every construct that
 * should be recognized, and prose that must be left alone.
 */
describe('looksLikeMarkdown', () => {
  it.each([
    ['a heading', '# Rollout plan'],
    ['a bullet list', '- One\n- Two'],
    ['a task list', '- [ ] Flip the flag'],
    ['an ordered list', '1. First'],
    ['a blockquote', '> Quoted'],
    ['a fenced block', '```ts\nconst x = 1;\n```'],
    ['a thematic break', '---'],
    ['a table row', '| Name | Count |'],
    ['a link', 'See [the plan](https://docket.test)'],
    ['bold text', 'A **bold** claim'],
    ['inline code', 'Run `pnpm test` first'],
  ])('recognizes %s', (_label, text) => {
    expect(looksLikeMarkdown(text)).toBe(true);
  });

  it.each([
    ['plain prose', 'Just a sentence about the release.'],
    ['a bare URL', 'https://docket.test/orgs/o/tasks/t'],
    ['a hyphenated phrase', 'The follow-up is state-of-the-art.'],
    ['an arithmetic expression', 'total = 3 * 4 - 1'],
    ['a diff header', '+++ b/src/index.ts'],
    ['empty text', ''],
  ])('leaves %s alone', (_label, text) => {
    expect(looksLikeMarkdown(text)).toBe(false);
  });
});
