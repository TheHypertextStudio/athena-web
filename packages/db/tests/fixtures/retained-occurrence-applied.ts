import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import type { Database } from '../../src/client';
import { migrationRows } from '../../src/work-template-blueprint-migration/query';
import type { BlueprintRetainedFixture } from './work-template-blueprint-migration';

/** Verify actual-engine private acceptance markers cannot be forged, cleared, changed or rebound. */
export async function exerciseRetainedOccurrenceApplied(
  database: Database,
  fixture: BlueprintRetainedFixture,
): Promise<void> {
  assert.equal(
    (
      await migrationRows<{ blueprint_applied_at: unknown }>(
        database,
        sql`select blueprint_applied_at from process_occurrence where organization_id=${fixture.organizationId} limit 1`,
      )
    )[0]?.blueprint_applied_at,
    null,
  );
  await assert.rejects(
    database.execute(
      sql`update process_occurrence set blueprint_invocation_id=null,blueprint_applied_at=now() where organization_id=${fixture.organizationId}`,
    ),
  );
  await assert.rejects(
    database.execute(
      sql`update process_occurrence set blueprint_invocation_id=(select id from work_template_blueprint_invocation where organization_id=${fixture.organizationId} and manifest->>'kind'='pending_draft' limit 1),blueprint_applied_at=now() where organization_id=${fixture.organizationId}`,
    ),
  );
  await database.execute(
    sql`update process_occurrence set blueprint_applied_at='2026-11-01T15:30:00Z' where organization_id=${fixture.organizationId}`,
  );
  await assert.rejects(
    database.execute(
      sql`update process_occurrence set blueprint_applied_at=null where organization_id=${fixture.organizationId}`,
    ),
  );
  await assert.rejects(
    database.execute(
      sql`update process_occurrence set blueprint_applied_at=blueprint_applied_at+interval '1 second' where organization_id=${fixture.organizationId}`,
    ),
  );
  await assert.rejects(
    database.execute(
      sql`update process_occurrence set blueprint_invocation_id=null where organization_id=${fixture.organizationId}`,
    ),
  );
}
