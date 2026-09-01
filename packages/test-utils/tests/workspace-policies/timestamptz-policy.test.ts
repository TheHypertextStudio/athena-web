/**
 * Every new timestamp column stores an instant, not a wall clock.
 *
 * @remarks
 * `docs/engineering/docket-engineering-plan.md` freezes the rule: "All timestamps are `timestamptz`
 * (`{ withTimezone: true }`)". Nothing has ever checked it, and the schema now holds hundreds of
 * naive `timestamp(...)` columns that disagree with it.
 *
 * The defect is quiet and it is not theoretical. A naive column taking Postgres `now()` stores the
 * server's local wall clock and is read back as UTC, so a row written a second ago can report hours
 * old. That is exactly what happened to `service_probe.checked_at`: on a status board whose entire
 * value is knowing how fresh a verdict is, every check read as eight hours stale the moment it was
 * written, and the cause looked like a UI bug for as long as anyone looked at the UI.
 *
 * Migrating the existing columns is a data migration per column and belongs to its own effort. What
 * this test does is stop the count growing: the ledger below is the exact set that predates the
 * rule being enforced, it may only shrink, and any column not in it must comply. A file with no
 * ledger entry is held to the rule in full.
 *
 * To pay debt down, migrate a column to `{ withTimezone: true }` and lower that file's number. The
 * test fails if a number is left higher than the file's actual count, so the ledger cannot drift
 * upward or go stale.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { WORKSPACE_ROOT } from '../workspace';

/** Where the schema islands live. */
const SCHEMA_DIR = resolve(WORKSPACE_ROOT, 'packages/db/src/schema');

/**
 * Naive `timestamp(...)` columns each file is still allowed, because they predate the rule.
 *
 * @remarks
 * One-way: a number may fall and a key may disappear, never the reverse. A file absent from this
 * map must have none at all.
 */
const NAIVE_TIMESTAMP_DEBT: Readonly<Record<string, number>> = {
  'admin.ts': 12,
  'agents.ts': 51,
  'athena-mail.ts': 3,
  'auth.ts': 26,
  'billing.ts': 45,
  'calendar.ts': 37,
  'change-set.ts': 2,
  'crosscutting.ts': 43,
  'elicitation.ts': 7,
  'event.ts': 22,
  'identity.ts': 24,
  'infra.ts': 6,
  'joins.ts': 2,
  'mcp-tasks.ts': 3,
  'mcp.ts': 4,
  'notion-mirror.ts': 16,
  'phone.ts': 16,
  'publishing.ts': 4,
  'recurrence.ts': 7,
  'resources.ts': 6,
  'scheduling.ts': 21,
  'search.ts': 10,
  'time.ts': 31,
  'work-location-sync.ts': 13,
  'work-location.ts': 14,
  'work.ts': 15,
};

/** Count the naive `timestamp(...)` declarations in one schema file. */
function naiveTimestamps(source: string): number {
  // A compliant column reads `timestamp('name', { withTimezone: true })`; a naive one closes its
  // argument list right after the name.
  return (source.match(/\btimestamp\(\s*'[^']+'\s*\)/g) ?? []).length;
}

/** Every schema island, by file name. */
function schemaFiles(): string[] {
  return readdirSync(SCHEMA_DIR)
    .filter((name) => name.endsWith('.ts') && name !== 'index.ts')
    .sort();
}

describe('timestamp columns store instants', () => {
  it('lets no file introduce a naive timestamp beyond its frozen allowance', () => {
    const over = schemaFiles()
      .map((file) => {
        const found = naiveTimestamps(readFileSync(resolve(SCHEMA_DIR, file), 'utf8'));
        return { file, found, allowed: NAIVE_TIMESTAMP_DEBT[file] ?? 0 };
      })
      .filter((entry) => entry.found > entry.allowed);

    expect(over).toEqual([]);
  });

  it('holds the ledger to the real count, so paid-down debt cannot be re-spent', () => {
    const stale = schemaFiles()
      .map((file) => {
        const found = naiveTimestamps(readFileSync(resolve(SCHEMA_DIR, file), 'utf8'));
        return { file, found, allowed: NAIVE_TIMESTAMP_DEBT[file] ?? 0 };
      })
      .filter((entry) => entry.allowed > entry.found);

    // A number left above the file's actual count is budget a future column could silently spend.
    expect(stale).toEqual([]);
  });

  it('names every ledger key as a schema file that exists', () => {
    const files = new Set(schemaFiles());
    expect(Object.keys(NAIVE_TIMESTAMP_DEBT).filter((file) => !files.has(file))).toEqual([]);
  });
});
