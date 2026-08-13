import '@testing-library/jest-dom/vitest';

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ExcerptMarkdown } from '../../../src/components/mentions/excerpt-markdown';

afterEach(cleanup);

describe('ExcerptMarkdown', () => {
  it('renders a heading as bold lead-in text rather than its own block element', () => {
    const { container } = render(
      <ExcerptMarkdown value={'# Executive Summary\n\nWe are going to ship it.'} />,
    );
    expect(container.querySelector('h1, h2, h3')).toBeNull();
    const strong = container.querySelector('strong');
    expect(strong?.textContent).toBe('Executive Summary');
    expect(container.textContent).toBe('Executive Summary We are going to ship it. ');
  });

  it('renders emphasis and inline code for real, not as flattened text', () => {
    const { container } = render(
      <ExcerptMarkdown value={'Some *emphasized* text and `inline code`.'} />,
    );
    expect(container.querySelector('em')?.textContent).toBe('emphasized');
    expect(container.querySelector('code')?.textContent).toBe('inline code');
  });

  it('renders a link as a real anchor', () => {
    const { container } = render(
      <ExcerptMarkdown value={'See [the plan](https://example.com).'} />,
    );
    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://example.com');
    expect(link?.textContent).toBe('the plan');
  });

  it('renders list items as inline bullets rather than a <ul>/<li> block', () => {
    const { container } = render(
      <ExcerptMarkdown value={'- Ship the launch\n- Write the retro'} />,
    );
    expect(container.querySelector('ul, li')).toBeNull();
    expect(container.textContent).toBe('• Ship the launch • Write the retro ');
  });

  it('drops fenced code blocks and tables entirely rather than quoting source', () => {
    const markdown = [
      'Before.',
      '',
      '```ts',
      'const x = 1;',
      '```',
      '',
      '| A | B |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      'After.',
    ].join('\n');
    const { container } = render(<ExcerptMarkdown value={markdown} />);
    expect(container.querySelector('table, pre')).toBeNull();
    expect(container.textContent).toBe('Before. After. ');
  });

  it('renders as a single flowing block a line-clamp can truncate', () => {
    const { container } = render(
      <ExcerptMarkdown
        value={'# Executive Summary\n\nFirst paragraph.\n\n## Overview\n\nSecond paragraph.'}
        className="line-clamp-3"
      />,
    );
    // One <p>, not separate block elements per section — line-clamp only works within one block.
    expect(container.children).toHaveLength(1);
    expect(container.firstElementChild?.tagName).toBe('P');
    expect(container.firstElementChild).toHaveClass('line-clamp-3');
  });
});
