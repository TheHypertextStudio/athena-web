import '@testing-library/jest-dom/vitest';

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { StaticMarkdown } from '../../src/components/editor/static-markdown';
import { ExcerptMarkdown } from '../../src/components/mentions/excerpt-markdown';

afterEach(cleanup);

/** How the editor stores `Agency & Coalitions <draft>` typed into a document. */
const STORED = 'Institutional &amp; Agency &lt;draft&gt;';

describe('stored entities in read-only Markdown', () => {
  it('renders an encoded ampersand in a document as the one character the author typed', () => {
    const { container } = render(<StaticMarkdown value={STORED} />);
    const text = container.querySelector('p')?.textContent ?? '';
    expect(text).not.toContain('&amp;');
    expect(text.split('&')).toHaveLength(2);
    expect(text).toContain('<draft>');
  });

  it('decodes prose inside emphasis, links, and list items', () => {
    const { container } = render(
      <StaticMarkdown value={'- **R&amp;D** and [Q&amp;A](https://example.com)'} />,
    );
    expect(container.querySelector('strong')?.textContent).toBe('R&D');
    expect(container.querySelector('a')?.textContent).toBe('Q&A');
  });

  it('keeps an entity inside a code span or code block exactly as written', () => {
    const { container } = render(
      <StaticMarkdown value={'Type `&amp;` for an ampersand.\n\n```\na &amp;&amp; b\n```'} />,
    );
    const codes = [...container.querySelectorAll('code')].map((node) => node.textContent);
    expect(codes[0]).toBe('&amp;');
    expect(container.textContent).toContain('a &amp;&amp; b');
  });

  it('decodes a hovercard excerpt the same way', () => {
    const { container } = render(<ExcerptMarkdown value={`# R&amp;D\n\n${STORED} \`&amp;\``} />);
    expect(container.querySelector('strong')?.textContent).toBe('R&D');
    expect(container.querySelector('code')?.textContent).toBe('&amp;');
    const prose = container.textContent.replace('&amp;', '');
    expect(prose).not.toContain('&amp;');
  });
});
