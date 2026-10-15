import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import type { Database } from '../../src/client';

/** Exercise backward-compatible root-state ownership through the real SQL validator. */
export async function exerciseManagedDependencies(
  database: Database,
  organizationId: string,
): Promise<void> {
  const state = {
    revision: 0,
    generationKey: 'regression',
    resolvedManifest: [],
    optionalChoices: [],
    creationTimezone: 'UTC',
    workingWeekdays: [1, 2, 3, 4, 5],
    lastApplicationChangeSetId: null,
  };
  const validate = (value: unknown) =>
    database.execute(
      sql`select docket_validate_blueprint_state(${JSON.stringify(value)}::jsonb,${organizationId})`,
    );
  await validate(state);
  await validate({ ...state, managedDependencies: [] });
  await validate({ ...state, managedDependencies: [{ blockerId: 'a', blockedId: 'b' }] });
  await validate({
    ...state,
    managedDependencies: Array.from({ length: 2000 }, (_, i) => ({
      blockerId: `a${i}`,
      blockedId: `b${i}`,
    })),
  });
  for (const invalid of [
    null,
    {},
    [{ blockerId: 'a' }],
    [{ blockerId: 1, blockedId: 'b' }],
    [{ blockerId: '', blockedId: 'b' }],
    [{ blockerId: 'a', blockedId: 'b', extra: true }],
    Array.from({ length: 2001 }, () => ({ blockerId: 'a', blockedId: 'b' })),
  ])
    await assert.rejects(validate({ ...state, managedDependencies: invalid }));
  await assert.rejects(validate({ ...state, unknown: true }));
}
