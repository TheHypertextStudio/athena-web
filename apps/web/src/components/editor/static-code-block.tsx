'use client';

import type { JSX, ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';

import { CodeBlockFrame } from './code-block-frame';
import { codeLanguageLoader } from './code-language-loader';

type HighlightTree = NonNullable<ReturnType<typeof codeLanguageLoader.highlight>>;
type HighlightNode = HighlightTree['children'][number];

function renderHighlightNode(node: HighlightNode, key: string): ReactNode {
  if (node.type === 'text') return node.value;
  if (node.type !== 'element') return null;
  const classes = Array.isArray(node.properties.className)
    ? node.properties.className.filter((value): value is string => typeof value === 'string')
    : [];
  return (
    <span key={key} className={classes.join(' ')}>
      {node.children.map((child, index) => renderHighlightNode(child, `${key}-${index}`))}
    </span>
  );
}

/** Highlight one static code block after its exact grammar chunk settles. */
export function StaticCode({ language, value }: { language: string; value: string }): JSX.Element {
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    void codeLanguageLoader.ensure(language).then(() => {
      if (active) setRevision((current) => current + 1);
    });
    return () => {
      active = false;
    };
  }, [language]);

  const tree = useMemo(
    () => codeLanguageLoader.highlight(language, value),
    [language, value, revision],
  );
  return (
    <CodeBlockFrame code={value} language={language}>
      <code style={{ whiteSpace: 'pre' }}>
        {tree?.children.map((node, index) => renderHighlightNode(node, String(index))) ?? value}
      </code>
    </CodeBlockFrame>
  );
}
