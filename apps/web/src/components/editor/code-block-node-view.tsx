'use client';

import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useEffect, useState } from 'react';

import { CodeBlockFrame } from './code-block-frame';

/** Render a Markdown code block with quiet language and copy affordances. */
export default function CodeBlockNodeView({
  editor,
  node,
  updateAttributes,
}: NodeViewProps): React.JSX.Element {
  const [editable, setEditable] = useState(editor.isEditable);
  const storedLanguage = typeof node.attrs['language'] === 'string' ? node.attrs['language'] : '';

  useEffect(() => {
    const syncEditable = (): void => {
      setEditable(editor.isEditable);
    };
    editor.on('update', syncEditable);
    return () => {
      editor.off('update', syncEditable);
    };
  }, [editor]);

  return (
    <NodeViewWrapper>
      <CodeBlockFrame
        code={node.textContent}
        language={storedLanguage}
        editableLanguage={editable}
        onLanguageChange={(language) => {
          updateAttributes({ language: language || null });
        }}
      >
        <NodeViewContent<'code'> as="code" style={{ whiteSpace: 'pre' }} />
      </CodeBlockFrame>
    </NodeViewWrapper>
  );
}
