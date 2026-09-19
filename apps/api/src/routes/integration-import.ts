import { db, task, team } from '@docket/db';
import type { ImportedItem } from '@docket/integrations';
import { and, asc, eq } from 'drizzle-orm';

import { ConflictError } from '../error';
import { enqueueSearchUpsert } from '../search/write-through';
import { type IntegrationRow, toTaskOut } from './integration-provider';
import { landingStatus } from '../lib/work-status';

/** Options for materializing imported items. */
export interface ImportItemsOptions {
  readonly orgId: string;
  readonly actorId: string;
  readonly integrationId: string;
  readonly teamId: string;
  readonly items: readonly ImportedItem[];
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

/** Materialize imported items as linked tasks, skipping any already imported. */
export async function importItems(
  opts: ImportItemsOptions,
): Promise<ReturnType<typeof toTaskOut>[]> {
  const landing = await landingStatus(opts.orgId, 'task', opts.teamId);
  const state = landing.key;
  const created: ReturnType<typeof toTaskOut>[] = [];
  for (const item of opts.items) {
    const externalId = item.provenance.externalId;
    const existing = await db
      .select({ id: task.id })
      .from(task)
      .where(
        and(
          eq(task.organizationId, opts.orgId),
          eq(task.source, 'linked'),
          eq(task.sourceIntegrationId, opts.integrationId),
          eq(task.externalId, externalId),
        ),
      )
      .limit(1);
    if (existing[0]) continue;
    const inserted = await db
      .insert(task)
      .values({
        organizationId: opts.orgId,
        title: item.title,
        description: item.body ?? null,
        teamId: opts.teamId,
        statusId: landing.id,
        state,
        ...(opts.assigneeId !== null ? { assigneeId: opts.assigneeId } : {}),
        source: 'linked',
        sourceIntegrationId: opts.integrationId,
        externalId,
        externalUrl: item.provenance.externalUrl ?? null,
        sourceSyncMode: 'mirror',
        createdBy: opts.actorId,
      })
      .returning();
    const taskRow = inserted[0];
    /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
    if (!taskRow) throw new Error('linked task insert returned no row');
    await enqueueSearchUpsert(opts.orgId, 'task', taskRow.id);
    created.push(toTaskOut(taskRow));
  }
  return created;
}
