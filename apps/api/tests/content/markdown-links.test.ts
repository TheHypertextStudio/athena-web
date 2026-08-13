import { describe, expect, it } from 'vitest';

import { extractMarkdownLinks, markdownToPlainText } from '../../src/content/markdown-links';

describe('extractMarkdownLinks', () => {
  it('returns nothing for empty or whitespace-only prose', () => {
    expect(extractMarkdownLinks('')).toEqual([]);
    expect(extractMarkdownLinks('   \n\n  ')).toEqual([]);
  });

  it('captures a link with its title slot intact', () => {
    expect(
      extractMarkdownLinks('See [the plan](https://x/d/1 "docket:v1:external") today.'),
    ).toEqual([
      { label: 'the plan', href: 'https://x/d/1', title: 'docket:v1:external', position: 0 },
    ]);
  });

  it('reports a titleless link with an undefined title rather than an empty string', () => {
    expect(extractMarkdownLinks('[docs](https://example.com)')[0]?.title).toBeUndefined();
  });

  it('numbers links in document order across blocks', () => {
    const markdown = [
      '# Heading with [one](https://a)',
      '',
      '- item with [two](https://b)',
      '- item with [three](https://c)',
      '',
      '> quoted [four](https://d)',
    ].join('\n');
    expect(extractMarkdownLinks(markdown).map((l) => [l.position, l.href])).toEqual([
      [0, 'https://a'],
      [1, 'https://b'],
      [2, 'https://c'],
      [3, 'https://d'],
    ]);
  });

  it('ignores links inside a fenced code block', () => {
    const markdown = [
      'Real [link](https://real).',
      '',
      '```md',
      '[fake](https://fake)',
      '```',
    ].join('\n');
    expect(extractMarkdownLinks(markdown).map((l) => l.href)).toEqual(['https://real']);
  });

  it('ignores links inside an indented code block', () => {
    const markdown = ['Real [link](https://real).', '', '    [fake](https://fake)'].join('\n');
    expect(extractMarkdownLinks(markdown).map((l) => l.href)).toEqual(['https://real']);
  });

  it('ignores a link inside an inline code span', () => {
    expect(extractMarkdownLinks('Write `[fake](https://fake)` to link.')).toEqual([]);
  });

  it('flattens emphasis inside a label', () => {
    expect(extractMarkdownLinks('[**Q3** _plan_](https://a)')[0]?.label).toBe('Q3 plan');
  });

  it('finds links inside table cells', () => {
    const markdown = [
      '| Doc | Owner |',
      '| --- | --- |',
      '| [spec](https://spec) | [Priya](https://priya) |',
    ].join('\n');
    expect(extractMarkdownLinks(markdown).map((l) => l.href)).toEqual([
      'https://spec',
      'https://priya',
    ]);
  });

  it('finds links nested in a sub-list', () => {
    const markdown = ['- outer', '  - inner with [deep](https://deep)'].join('\n');
    expect(extractMarkdownLinks(markdown).map((l) => l.href)).toEqual(['https://deep']);
  });

  it('captures an autolinked bare URL, since a pasted link is still a reference', () => {
    const links = extractMarkdownLinks('Context: https://example.com/page');
    expect(links).toHaveLength(1);
    expect(links[0]?.href).toBe('https://example.com/page');
  });

  it('keeps a label that renders as an image rather than dropping the link', () => {
    const links = extractMarkdownLinks('[![alt](https://img.png)](https://target)');
    expect(links.map((l) => l.href)).toEqual(['https://target']);
    expect(links[0]?.label).not.toBe('');
  });
});

describe('markdownToPlainText', () => {
  it('returns an empty string for empty or whitespace-only prose', () => {
    expect(markdownToPlainText('')).toBe('');
    expect(markdownToPlainText('   \n\n  ')).toBe('');
  });

  it('strips heading markers rather than quoting the literal hash', () => {
    expect(markdownToPlainText('# Executive Summary')).toBe('Executive Summary');
  });

  it('flattens emphasis and joins multiple blocks into one line', () => {
    const markdown = [
      '# Executive Summary',
      '',
      "I'm going to do things that spark joy in my everyday life.",
      '',
      '# Overview',
      '',
      '*A detailed description of the plan.*',
    ].join('\n');
    expect(markdownToPlainText(markdown)).toBe(
      "Executive Summary I'm going to do things that spark joy in my everyday life. Overview A detailed description of the plan.",
    );
  });

  it('flattens a link to its label text, not the raw markdown syntax', () => {
    expect(markdownToPlainText('See [the plan](https://x/d/1 "docket:v1:external") today.')).toBe(
      'See the plan today.',
    );
  });

  it('includes list item text without bullet markup', () => {
    const markdown = ['Goals:', '', '- Ship the launch', '- Write the retro'].join('\n');
    expect(markdownToPlainText(markdown)).toBe('Goals: Ship the launch Write the retro');
  });

  it('drops fenced code blocks entirely rather than quoting source', () => {
    const markdown = ['Before.', '', '```ts', 'const x = 1;', '```', '', 'After.'].join('\n');
    expect(markdownToPlainText(markdown)).toBe('Before. After.');
  });

  it('drops tables entirely, matching the mention hovercard excerpt renderer', () => {
    // A flattened row/column jumble reads worse than showing nothing — the same call
    // `apps/web/src/components/mentions/excerpt-markdown.tsx`'s EXCERPT_BLOCK_SKIP already makes.
    const markdown = ['Before.', '', '| A | B |', '| --- | --- |', '| 1 | 2 |', '', 'After.'].join(
      '\n',
    );
    expect(markdownToPlainText(markdown)).toBe('Before. After.');
  });

  it('collapses internal newlines and repeated whitespace to single spaces', () => {
    expect(markdownToPlainText('Line one.\nLine   two.')).toBe('Line one. Line two.');
  });

  it('leaves text at or under the limit untouched', () => {
    const text = 'Short summary.';
    expect(markdownToPlainText(text, 280)).toBe('Short summary.');
  });

  it('truncates at a word boundary with a trailing ellipsis when over the limit', () => {
    const words = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
    const result = markdownToPlainText(words, 40);
    expect(result.length).toBeLessThanOrEqual(41);
    expect(result.endsWith('…')).toBe(true);
    expect(result.slice(0, -1)).not.toMatch(/\s$/);
    expect(words.startsWith(result.slice(0, -1))).toBe(true);
  });
});
