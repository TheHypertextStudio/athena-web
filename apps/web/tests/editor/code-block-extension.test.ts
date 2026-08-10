import { Editor, type NodeViewRenderer } from '@tiptap/core';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCodeBlockExtension } from '@/components/editor/code-block-extension';
import type { CodeLanguageLoader } from '@/components/editor/code-language-loader';

const editors: Editor[] = [];

afterEach(() => {
  editors.splice(0).forEach((editor) => {
    editor.destroy();
  });
});

function testNodeView(): NodeViewRenderer {
  return () => {
    const dom = document.createElement('pre');
    const contentDOM = document.createElement('code');
    dom.append(contentDOM);
    return { dom, contentDOM };
  };
}

function testLoader(): CodeLanguageLoader {
  const highlight = vi.fn<CodeLanguageLoader['highlight']>((_language, value) => ({
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'span',
        properties: { className: ['hljs-keyword'] },
        children: [{ type: 'text', value }],
      },
    ],
    data: { language: 'typescript', relevance: 1 },
  }));
  return {
    ensure: async () => 'ready',
    status: () => 'ready',
    highlight,
    subscribe: vi.fn(() => () => undefined),
  };
}

describe('code block decoration updates', () => {
  it('maps unchanged tokens through prose edits and rebuilds only a changed code block', () => {
    const loader = testLoader();
    const editor = new Editor({
      extensions: [
        StarterKit.configure({ codeBlock: false }),
        createCodeBlockExtension(testNodeView(), loader),
        Markdown.configure({ markedOptions: { gfm: true, breaks: false } }),
      ],
      content: 'Prose before.\n\n```typescript\nconst ready = true\n```',
      contentType: 'markdown',
    });
    editors.push(editor);

    expect(loader.highlight).toHaveBeenCalledTimes(1);
    editor.view.dispatch(editor.state.tr.insertText('x', 2));
    expect(loader.highlight).toHaveBeenCalledTimes(1);

    let codePosition = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'codeBlock') codePosition = pos;
    });
    editor.view.dispatch(editor.state.tr.insertText('x', codePosition + 2));
    expect(loader.highlight).toHaveBeenCalledTimes(2);

    expect(editor.view.dom.querySelector('.hljs-keyword')).not.toBeNull();
    editor.commands.setTextSelection(codePosition + 2);
    editor.commands.toggleCodeBlock();
    let hasCodeBlock = false;
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'codeBlock') hasCodeBlock = true;
    });
    expect(hasCodeBlock).toBe(false);
    expect(editor.view.dom.querySelector('.hljs-keyword')).toBeNull();
  });
});
