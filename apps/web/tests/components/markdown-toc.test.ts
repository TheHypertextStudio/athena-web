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

  it('displays plain text, not the Markdown source Tiptap serialized it as', () => {
    expect(
      extractMarkdownHeadings(String.raw`## 3\*4
## **Launch** plan
## _Q3_ goals
## Ask \`support\`
## [Docket](https://example.com) rollout`),
    ).toEqual([
      { level: 2, text: '3*4', id: '34' },
      { level: 2, text: 'Launch plan', id: 'launch-plan' },
      { level: 2, text: 'Q3 goals', id: 'q3-goals' },
      { level: 2, text: 'Ask `support`', id: 'ask-support' },
      { level: 2, text: 'Docket rollout', id: 'docket-rollout' },
    ]);
  });
});
