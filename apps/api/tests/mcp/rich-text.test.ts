import { describe, expect, it } from 'vitest';

import { serializeDocumentFigure } from '@docket/markdown-tree';

import { richTextOf } from '../../src/mcp/apps/rich-text';

const BRIEF = [
  '# Executive Summary',
  '',
  "LVBT's week without driving is a short media campaign.",
  '',
  '## Motivation',
  '',
  'This project aligns with:',
  '',
  '- Priority 3: Build a Community of Urbanists',
  '  - A campaign focused on *not* driving.',
  '- Priority 5: Institutional &amp; Agency Coalitions',
].join('\n');

describe('richTextOf', () => {
  it('reads nothing from an empty field', () => {
    expect(richTextOf('')).toBeNull();
    expect(richTextOf('  \n ')).toBeNull();
    expect(richTextOf(null)).toBeNull();
  });

  it('keeps headings, paragraphs, and nested lists as structure', () => {
    const rich = richTextOf(BRIEF);
    expect(rich?.blocks.map((block) => block.kind)).toEqual([
      'heading',
      'paragraph',
      'heading',
      'paragraph',
      'list',
    ]);
    const list = rich?.blocks[4];
    expect(list).toMatchObject({ kind: 'list', ordered: false });
    expect(list?.kind === 'list' && list.items[0]?.blocks.map((b) => b.kind)).toEqual([
      'paragraph',
      'list',
    ]);
  });

  it('decodes the entities the editor stores, and only in prose', () => {
    const rich = richTextOf('Agency &amp; Coalitions `&amp;`');
    expect(rich?.blocks[0]).toEqual({
      kind: 'paragraph',
      inlines: [
        { kind: 'text', text: 'Agency & Coalitions ' },
        { kind: 'code', text: '&amp;' },
      ],
    });
  });

  it('leads its excerpt with the first paragraph rather than the first heading', () => {
    expect(richTextOf(BRIEF)?.excerpt).toBe(
      "LVBT's week without driving is a short media campaign.",
    );
  });

  it('writes an excerpt for a document that is only a checklist', () => {
    expect(richTextOf('- [x] Monday\n- [ ] Tuesday')?.excerpt).toBe('Monday Tuesday');
  });

  it('marks a loose checklist the same way, without its marker in the words', () => {
    const rich = richTextOf('- [ ] Tuesday\n\n- [x] Monday');
    const list = rich?.blocks[0];
    expect(list?.kind === 'list' && list.items.map((item) => item.checked)).toEqual([false, true]);
    expect(list?.kind === 'list' && list.items[0]?.blocks).toEqual([
      { kind: 'paragraph', inlines: [{ kind: 'text', text: 'Tuesday' }] },
    ]);
  });

  it('drops an image with no alt text and leads with a quoted paragraph when that is all there is', () => {
    const rich = richTextOf('# Title\n\n> The quoted lead.\n\n![](https://x.y/i.png)');
    expect(rich?.excerpt).toBe('The quoted lead.');
    expect(rich?.blocks.map((block) => block.kind)).toEqual(['heading', 'quote']);
  });

  it('marks checklist items with their tick', () => {
    const rich = richTextOf('- [x] Monday\n- [ ] Tuesday');
    const list = rich?.blocks[0];
    expect(list?.kind === 'list' && list.items.map((item) => item.checked)).toEqual([true, false]);
  });

  it('keeps safe links and turns unsafe ones into their words', () => {
    const rich = richTextOf('[site](https://x.y) [bad](javascript:alert(1)) [app](/orgs/o/p)');
    expect(rich?.blocks[0]).toEqual({
      kind: 'paragraph',
      inlines: [
        { kind: 'link', href: 'https://x.y', inlines: [{ kind: 'text', text: 'site' }] },
        { kind: 'text', text: ' ' },
        { kind: 'text', text: 'bad' },
        { kind: 'text', text: ' ' },
        { kind: 'link', href: '/orgs/o/p', inlines: [{ kind: 'text', text: 'app' }] },
      ],
    });
  });

  it('drops raw HTML and reads an image as its alt text', () => {
    const rich = richTextOf('<script>x</script>\n\nSee ![the map](https://x.y/m.png) <b>now</b>');
    expect(rich?.blocks).toEqual([
      {
        kind: 'paragraph',
        inlines: [
          { kind: 'text', text: 'See ' },
          { kind: 'text', text: 'the map' },
          { kind: 'text', text: ' ' },
          { kind: 'text', text: 'now' },
        ],
      },
    ]);
  });

  it('keeps an HTML line break as a break', () => {
    expect(richTextOf('line one<br>line two')?.blocks).toEqual([
      {
        kind: 'paragraph',
        inlines: [
          { kind: 'text', text: 'line one' },
          { kind: 'break' },
          { kind: 'text', text: 'line two' },
        ],
      },
    ]);
  });

  it('caps headings at the third level and keeps quotes, code, dividers, and tables', () => {
    const rich = richTextOf(
      [
        '#### Deep',
        '',
        '> quoted',
        '',
        '---',
        '',
        '```',
        'a < b',
        '```',
        '',
        '| A | B |',
        '| - | - |',
        '| 1 | 2 |',
      ].join('\n'),
    );
    expect(rich?.blocks.map((block) => block.kind)).toEqual([
      'heading',
      'quote',
      'divider',
      'code',
      'table',
    ]);
    expect(rich?.blocks[0]).toMatchObject({ level: 3 });
    expect(rich?.blocks[3]).toEqual({ kind: 'code', text: 'a < b' });
  });

  it('keeps an ordered list’s start, escapes, and hard line breaks', () => {
    const rich = richTextOf('3. third\n4. fourth\n\nA \\*literal\\* star  \nnext line');
    expect(rich?.blocks[0]).toMatchObject({ kind: 'list', ordered: true, start: 3 });
    expect(rich?.blocks[1]).toEqual({
      kind: 'paragraph',
      inlines: [
        { kind: 'text', text: 'A ' },
        { kind: 'text', text: '*' },
        { kind: 'text', text: 'literal' },
        { kind: 'text', text: '*' },
        { kind: 'text', text: ' star' },
        { kind: 'break' },
        { kind: 'text', text: 'next line' },
      ],
    });
  });

  it('reads the editor’s figure as its caption and a document of raw HTML as nothing', () => {
    const figure = serializeDocumentFigure({
      version: 1,
      src: '/v1/orgs/o/images/i',
      alt: 'Riders boarding',
      decorative: false,
      caption: 'The first bus of the morning.',
    });
    const rich = richTextOf(figure);
    expect(rich?.blocks).toHaveLength(1);
    expect(rich?.blocks[0]).toMatchObject({ kind: 'paragraph', inlines: [{ kind: 'em' }] });
    expect(richTextOf('<div>raw</div>')).toBeNull();
  });

  it('stops at the budget and says so, while the excerpt still reads the whole document', () => {
    const rich = richTextOf(BRIEF, { maxBlocks: 0, maxChars: 0 });
    expect(rich?.blocks).toEqual([]);
    expect(rich?.truncated).toBe(true);
    expect(rich?.excerpt).toContain('week without driving');

    const two = richTextOf(BRIEF, { maxBlocks: 2, maxChars: 10_000 });
    expect(two?.blocks).toHaveLength(2);
    expect(two?.truncated).toBe(true);
  });
});
