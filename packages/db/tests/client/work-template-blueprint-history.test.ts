import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

interface HistoricalJournal {
  readonly journal_entries: readonly unknown[];
  readonly sql_sha256: Readonly<Record<string, string>>;
}

it('preserves every applied SQL byte and canonical journal entry through0153', () => {
  const baseline = JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, '../fixtures/work-template-historical-journal.json'),
      'utf8',
    ),
  ) as HistoricalJournal;
  const folder = resolve(import.meta.dirname, '../../drizzle');
  const current = JSON.parse(readFileSync(resolve(folder, 'meta/_journal.json'), 'utf8')) as {
    entries: unknown[];
  };
  expect(current.entries.slice(0, baseline.journal_entries.length)).toEqual(
    baseline.journal_entries,
  );
  for (const [tag, hash] of Object.entries(baseline.sql_sha256))
    expect(
      createHash('sha256')
        .update(readFileSync(resolve(folder, `${tag}.sql`)))
        .digest('hex'),
      tag,
    ).toBe(hash);
});
