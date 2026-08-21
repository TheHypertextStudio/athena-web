/**
 * `commentSearchProjector` / `updateSearchProjector` — a comment or update's search-document
 * `summary`, which a mention hovercard reads as its display excerpt the same way an
 * Initiative/Project/Program/Task's does.
 *
 * @remarks
 * Regression coverage for the raw-Markdown-in-`summary` bug fixed in `work.ts`'s projectors but
 * initially left unfixed here: both `comment.body` and `update.body` are authored Markdown, so a
 * verbatim `summary: row.body` reproduces the same literal `#`/`*` source in a hovercard.
 */
import { describe, expect, it } from 'vitest';

import {
  attachmentSearchProjector,
  commentSearchProjector,
  updateSearchProjector,
} from '../../src/search/projectors/content';

const BASE_ROW = {
  id: 'row-1',
  organizationId: 'org-1',
  subjectType: 'task',
  subjectId: 'task-1',
};

describe('commentSearchProjector summary', () => {
  it('strips Markdown from the body-derived summary', async () => {
    const doc = await commentSearchProjector.project({
      entityId: 'row-1',
      row: { ...BASE_ROW, body: '# Repro\n\nOpen the app in *any* timezone west of UTC.' },
    });
    expect(doc?.summary).toBe('Repro Open the app in any timezone west of UTC.');
    expect(doc?.summary).not.toContain('#');
    expect(doc?.summary).not.toContain('*');
  });

  it('keeps the full Markdown body for full-text-search matching', async () => {
    const doc = await commentSearchProjector.project({
      entityId: 'row-1',
      row: { ...BASE_ROW, body: '# Repro\n\nOpen the app in *any* timezone west of UTC.' },
    });
    expect(doc?.body).toBe('# Repro\n\nOpen the app in *any* timezone west of UTC.');
  });
});

describe('updateSearchProjector summary', () => {
  it('strips Markdown from the body-derived summary', async () => {
    const doc = await updateSearchProjector.project({
      entityId: 'row-1',
      row: { ...BASE_ROW, body: '# Status\n\nWe *shipped* the fix today.' },
    });
    expect(doc?.summary).toBe('Status We shipped the fix today.');
    expect(doc?.summary).not.toContain('#');
    expect(doc?.summary).not.toContain('*');
  });
});

describe('attachmentSearchProjector facets', () => {
  it('projects uploaded-file metadata without changing the SearchResult schema', async () => {
    const doc = await attachmentSearchProjector.project({
      entityId: 'attachment-1',
      row: {
        ...BASE_ROW,
        id: 'attachment-1',
        kind: 'file',
        title: 'Launch brief',
        fileName: 'launch-brief.pdf',
        mimeType: 'application/pdf',
        byteSize: 48_721,
      },
    });

    expect(doc?.facet).toMatchObject({
      attachmentKind: 'file',
      fileName: 'launch-brief.pdf',
      mimeType: 'application/pdf',
      byteSize: 48_721,
    });
  });
});
