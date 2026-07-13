import { describe, expect, it } from 'vitest';

import { extractMarkdownHeadings } from '../../src/components/initiatives/markdown-toc';

describe('Initiative Markdown contents', () => {
  it('extracts h1-h3 with stable duplicate-safe anchors', () => {
    expect(
      extractMarkdownHeadings(`# Overview
## Why now?
### Desired outcome
## Why now?
#### Ignored`),
    ).toEqual([
      { level: 1, text: 'Overview', id: 'overview' },
      { level: 2, text: 'Why now?', id: 'why-now' },
      { level: 3, text: 'Desired outcome', id: 'desired-outcome' },
      { level: 2, text: 'Why now?', id: 'why-now-2' },
    ]);
  });

  it('returns no contents for documents without headings', () => {
    expect(extractMarkdownHeadings('A short paragraph.')).toEqual([]);
  });
});
