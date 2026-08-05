import { describe, expect, it } from 'vitest';

import { extractMarkdownLinks } from '../../src/content/markdown-links';

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
