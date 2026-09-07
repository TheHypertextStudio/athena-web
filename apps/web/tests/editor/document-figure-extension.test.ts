import { Editor } from '@tiptap/core';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';

import { serializeDocumentFigure } from '@docket/markdown-tree';

import {
  createDocumentFigureExtension,
  DOCUMENT_FIGURE_NODE,
} from '../../src/components/editor/document-figure-extension';
import { installProseMirrorLayoutShims } from './prosemirror-jsdom';

installProseMirrorLayoutShims();

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function editorWith(markdown: string): Editor {
  editor = new Editor({
    extensions: [
      StarterKit,
      createDocumentFigureExtension(),
      Markdown.configure({ markedOptions: { gfm: true, breaks: false } }),
    ],
    content: markdown,
    contentType: 'markdown',
  });
  return editor;
}

describe('document figure extension', () => {
  it('round-trips a semantic figure through the editor without losing attribution', () => {
    const source = serializeDocumentFigure({
      version: 1,
      src: '/v1/orgs/org-1/images/image-1',
      alt: 'A bus at a stop',
      decorative: false,
      caption: 'Route 109 at Maryland Parkway.',
      creditText: 'RTC',
      sourceUrl: 'https://example.com/source',
      licenseText: 'CC BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    });
    const instance = editorWith(source);

    expect(instance.getMarkdown().trim()).toBe(source);
    expect(instance.state.doc.firstChild?.type.name).toBe(DOCUMENT_FIGURE_NODE);
    expect(instance.state.doc.firstChild?.attrs['caption']).toBe('Route 109 at Maryland Parkway.');
  });

  it('parses a legacy Markdown image and upgrades it only when serialized after an edit', () => {
    const instance = editorWith('![Route map](https://images.example.com/map.png "Draft route")');
    const figure = instance.state.doc.firstChild;

    expect(figure?.type.name).toBe(DOCUMENT_FIGURE_NODE);
    expect(figure?.attrs['alt']).toBe('Route map');
    expect(figure?.attrs['caption']).toBe('Draft route');
    expect(instance.getMarkdown()).toContain('<figure data-docket-figure="1"');
  });

  it('leaves malformed and unsupported arbitrary HTML as text', () => {
    const source = '<figure data-docket-figure="1"><script>alert(1)</script></figure>';
    const instance = editorWith(source);

    expect(instance.state.doc.firstChild?.type.name).not.toBe(DOCUMENT_FIGURE_NODE);
    expect(instance.getText()).toContain('data-docket-figure');
  });
});
