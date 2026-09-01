import { describe, expect, it } from 'vitest';

import {
  emptyWorkViewPages,
  reduceWorkViewPages,
  workViewPageForPath,
} from '../../src/components/work-views/use-work-view-pages';

interface Row {
  readonly id: string;
  readonly name: string;
}

describe('work-view page state', () => {
  it('keeps out-of-order group responses at their own paths', () => {
    const requested = reduceWorkViewPages(emptyWorkViewPages<Row>(), {
      type: 'request',
      path: ['A'],
      cursor: null,
    });
    const withBothRequests = reduceWorkViewPages(requested, {
      type: 'request',
      path: ['B'],
      cursor: null,
    });
    const bFirst = reduceWorkViewPages(withBothRequests, {
      type: 'success',
      path: ['B'],
      cursor: null,
      rows: [{ id: 'b-1', name: 'B row' }],
      nextCursor: null,
    });
    const resolved = reduceWorkViewPages(bFirst, {
      type: 'success',
      path: ['A'],
      cursor: null,
      rows: [{ id: 'a-1', name: 'A row' }],
      nextCursor: null,
    });

    expect(workViewPageForPath(resolved, ['A'])?.rows).toEqual([{ id: 'a-1', name: 'A row' }]);
    expect(workViewPageForPath(resolved, ['B'])?.rows).toEqual([{ id: 'b-1', name: 'B row' }]);
  });

  it('appends a continuation page without duplicating rows in that path', () => {
    const first = reduceWorkViewPages(emptyWorkViewPages<Row>(), {
      type: 'success',
      path: ['A'],
      cursor: null,
      rows: [{ id: 'a-1', name: 'First' }],
      nextCursor: 'cursor-2',
    });
    const appended = reduceWorkViewPages(first, {
      type: 'success',
      path: ['A'],
      cursor: 'cursor-2',
      rows: [
        { id: 'a-1', name: 'First' },
        { id: 'a-2', name: 'Second' },
      ],
      nextCursor: null,
    });

    expect(workViewPageForPath(appended, ['A'])?.rows.map((row) => row.id)).toEqual(['a-1', 'a-2']);
  });

  it('retains loaded rows and the failed cursor after a continuation failure', () => {
    const first = reduceWorkViewPages(emptyWorkViewPages<Row>(), {
      type: 'success',
      path: ['A'],
      cursor: null,
      rows: [{ id: 'a-1', name: 'First' }],
      nextCursor: 'cursor-2',
    });
    const failed = reduceWorkViewPages(first, {
      type: 'failure',
      path: ['A'],
      cursor: 'cursor-2',
      error: new Error('provider text must not render'),
    });

    expect(workViewPageForPath(failed, ['A'])).toMatchObject({
      rows: [{ id: 'a-1', name: 'First' }],
      nextCursor: 'cursor-2',
      retryCursor: 'cursor-2',
      loading: false,
    });
  });

  it('retries only the requested group path', () => {
    const withA = reduceWorkViewPages(emptyWorkViewPages<Row>(), {
      type: 'failure',
      path: ['A'],
      cursor: 'cursor-a',
      error: new Error('A failed'),
    });
    const withBoth = reduceWorkViewPages(withA, {
      type: 'failure',
      path: ['B'],
      cursor: 'cursor-b',
      error: new Error('B failed'),
    });
    const retryingA = reduceWorkViewPages(withBoth, {
      type: 'request',
      path: ['A'],
      cursor: 'cursor-a',
    });

    expect(workViewPageForPath(retryingA, ['A'])).toMatchObject({
      loading: true,
      error: null,
      retryCursor: 'cursor-a',
    });
    expect(workViewPageForPath(retryingA, ['B'])).toMatchObject({
      loading: false,
      retryCursor: 'cursor-b',
    });
  });
});
