import Link from '@tiptap/extension-link';
import { Markdown } from '@tiptap/markdown';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { formatMentionLink } from '../../../src/lib/contracts/mention';
import { describe, expect, it } from 'vitest';

import { createMentionExtension } from '@/components/mentions/mention-extension';

/**
 * Build an editor configured exactly as `FreeformTextEditor` configures one, minus the React node
 * view — which is presentation, and would drag jsdom rendering into a serialization test.
 */
function buildEditor(content: string): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        protocols: ['mailto'],
        validate: (href) => /^(https?:|mailto:|\/)/i.test(href),
      }),
      createMentionExtension(() => () => ({ dom: document.createElement('span') })),
      Markdown.configure({ markedOptions: { gfm: true, breaks: false } }),
    ],
    content,
    contentType: 'markdown',
  });
}

/** The JSON node types present in a parsed document, flattened. */
function nodeTypes(editor: Editor): string[] {
  const types: string[] = [];
  editor.state.doc.descendants((node) => {
    types.push(node.type.name);
    return true;
  });
  return types;
}

describe('mention markdown round trip', () => {
  it('parses an external mention into a mention node, not a plain link', () => {
    const url = 'https://docs.google.com/document/d/abc123/edit';
    const markdown = `Depends on ${formatMentionLink('Q3 launch plan', url, { kind: 'external', url })}.`;
    const editor = buildEditor(markdown);

    expect(nodeTypes(editor)).toContain('mention');
    editor.destroy();
  });

  it('parses an internal mention despite its href being app-relative', () => {
    // The regression this pins: Link's `validate` used to reject relative hrefs, so an internal
    // mention round-tripped into a rejected link and silently degraded to plain text.
    const href = '/orgs/01ARZ3NDEKTSV4RRFFQ69G5FAV/projects/01ARZ3NDEKTSV4RRFFQ69G5FAW';
    const markdown = formatMentionLink('Platform rebuild', href, {
      kind: 'entity',
      entityKind: 'project',
      entityId: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
    });
    const editor = buildEditor(markdown);

    expect(nodeTypes(editor)).toContain('mention');
    editor.destroy();
  });

  it('survives a full round trip byte for byte', () => {
    const url = 'https://docs.google.com/document/d/abc123/edit';
    const markdown = `See ${formatMentionLink('Q3 launch plan', url, { kind: 'external', url })} first.`;
    const editor = buildEditor(markdown);

    expect(editor.getMarkdown().trim()).toBe(markdown);
    editor.destroy();
  });

  it('leaves an ordinary link alone, so a URL somebody typed stays a URL', () => {
    const editor = buildEditor('Read [the docs](https://example.com/docs) later.');

    expect(nodeTypes(editor)).not.toContain('mention');
    expect(editor.getMarkdown()).toContain('[the docs](https://example.com/docs)');
    editor.destroy();
  });

  it('leaves a link with an ordinary title alone', () => {
    const editor = buildEditor('Read [docs](https://example.com "Our handbook") later.');

    expect(nodeTypes(editor)).not.toContain('mention');
    editor.destroy();
  });

  it('refuses to build a mention from a script-bearing href', () => {
    const editor = buildEditor('[Click](javascript:alert(1) "docket:v1:external")');

    expect(nodeTypes(editor)).not.toContain('mention');
    editor.destroy();
  });
});
