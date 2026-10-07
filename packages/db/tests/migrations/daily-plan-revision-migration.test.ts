/** Proves revision rollout preserves historical daily commitments. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(import.meta.dirname, '../../drizzle/0148_daily_plan_revision.sql'),
  'utf8',
);

describe('daily plan revision migration', () => {
  it('starts existing drafts at revision zero without rewriting accepted history', async () => {
    const client = new PGlite('memory://');
    try {
      await client.exec(
        'CREATE TABLE daily_plan_day (id text PRIMARY KEY, draft jsonb, accepted jsonb)',
      );
      const draft = {
        date: '2026-09-22',
        finishAt: '2026-09-22T22:00:00.000Z',
        mainTaskId: null,
        tasks: [],
        sessions: [],
      };
      const accepted = {
        original: { acceptedAt: '2026-09-22T08:00:00.000Z', snapshot: draft },
        current: { acceptedAt: '2026-09-22T08:00:00.000Z', snapshot: draft },
        history: [{ acceptedAt: '2026-09-22T08:00:00.000Z', snapshot: draft }],
      };
      await client.query(
        'INSERT INTO daily_plan_day (id, draft, accepted) VALUES ($1, $2::jsonb, $3::jsonb)',
        ['existing', JSON.stringify(draft), JSON.stringify(accepted)],
      );
      await client.exec(migration);
      const result = await client.query<{
        draft: typeof draft;
        accepted: typeof accepted;
        revision: number;
      }>('SELECT draft, accepted, revision FROM daily_plan_day');
      expect(result.rows).toEqual([{ draft, accepted, revision: 0 }]);
    } finally {
      await client.close();
    }
  });
});
