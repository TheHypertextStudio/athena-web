import { db, task, team } from '@docket/db';
import type { ImportedItem } from '@docket/integrations';
import { and, asc, eq } from 'drizzle-orm';

import { ConflictError } from '../error';
import { enqueueSearchUpsert } from '../search/write-through';

import { type IntegrationRow, toTaskOut } from './integration-provider';

/** Options controlling how imported items are materialized. */
export interface ImportItemsOptions {
  /**
   * The actor to assign each newly-mirrored linked task to, or `null` to leave it unassigned.
   *
   * @remarks
   * Onboarding passes the importing owner so the mirrored work lands under My Work's "Assigned
   * to me"; the general/sync path passes `null`, keeping org-wide mirrored work in Triage.
   */
  readonly assigneeId: string | null;
}

/**
 * Resolve the team a linked task should land in for an import.
 *
 * @remarks
 * Prefers a `teamId` configured on the integration's `config`, validated to belong to the
 * org; otherwise falls back to the org's earliest-created team.
 *
 * @param orgId - The active organization id.
 * @param row - The integration being imported from.
 * @throws {ConflictError} When the org has no team to attach imported work to.
 */
export async function resolveImportTeam(orgId: string, row: IntegrationRow): Promise<string> {
  const configured = row.config['teamId'];
  if (typeof configured === 'string') {
    const teamRows = await db
      .select({ id: team.id })
      .from(team)
      .where(and(eq(team.id, configured), eq(team.organizationId, orgId)))
      .limit(1);
    if (teamRows[0]) return teamRows[0].id;
    // configured teamId exists in config but not in this org — fall through to first-team fallback
  }
  const firstTeam = await db
    .select({ id: team.id })
    .from(team)
    .where(eq(team.organizationId, orgId))
    .orderBy(asc(team.createdAt))
    .limit(1);
  if (!firstTeam[0]) throw new ConflictError('Organization has no team to import work into');
  return firstTeam[0].id;
}

/**
 * Materialize imported items as linked tasks, skipping any already imported.
 *
 * @remarks
 * Each {@link ImportedItem} becomes a `linked` task (provenance `source='linked'`,
 * `sourceIntegrationId`, `externalId`/`externalUrl`, `sourceSyncMode='mirror'`).
 * Idempotency: an item whose `(sourceIntegrationId, externalId)` already exists is skipped,
 * so re-importing is safe.
 *
 * @param orgId - The active organization id.
 * @param actorId - The actor performing the import (recorded as `createdBy`).
 * @param integrationId - The source integration id.
 * @param teamId - The team the linked tasks attach to.
 * @param items - The imported items to materialize.
 * @param options - Materialization options.
 * @returns serialized newly created tasks (existing ones are omitted).
 */
export async function importItems(
  orgId: string,
  actorId: string,
  integrationId: string,
  teamId: string,
  items: readonly ImportedItem[],
  options: ImportItemsOptions,
): Promise<ReturnType<typeof toTaskOut>[]> {
  const teamRows = await db
    .select({ workflowStates: team.workflowStates })
    .from(team)
    .where(and(eq(team.id, teamId), eq(team.organizationId, orgId)))
    .limit(1);
  const state = teamRows[0]?.workflowStates[0]?.key ?? 'backlog';

  const created: ReturnType<typeof toTaskOut>[] = [];
  for (const item of items) {
    const externalId = item.provenance.externalId;
    const existing = await db
      .select({ id: task.id })
      .from(task)
      .where(
        and(
          eq(task.organizationId, orgId),
          eq(task.source, 'linked'),
          eq(task.sourceIntegrationId, integrationId),
          eq(task.externalId, externalId),
        ),
      )
      .limit(1);
    if (existing[0]) continue;

    const inserted = await db
      .insert(task)
      .values({
        organizationId: orgId,
        title: item.title,
        description: item.body ?? null,
        teamId,
        state,
        ...(options.assigneeId !== null ? { assigneeId: options.assigneeId } : {}),
        source: 'linked',
        sourceIntegrationId: integrationId,
        externalId,
        externalUrl: item.provenance.externalUrl ?? null,
        sourceSyncMode: 'mirror',
        createdBy: actorId,
      })
      .returning();
    const taskRow = inserted[0];
    /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
    if (!taskRow) throw new Error('linked task insert returned no row');
    await enqueueSearchUpsert(orgId, 'task', taskRow.id);
    created.push(toTaskOut(taskRow));
  }
  return created;
}
