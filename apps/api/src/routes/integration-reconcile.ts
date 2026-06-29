/**
 * `@docket/api` — connector sync reconciliation for linked tasks.
 *
 * @remarks
 * Converts a provider's imported work snapshot into durable linked tasks. For read-only mirrors
 * this is insert/pull/archive. For write-back connectors (currently Google Tasks), locally dirty
 * linked tasks are pushed first and restamped with the provider's acknowledgement so the next pull
 * does not echo the write back into Docket.
 */
import { db, task, team } from '@docket/db';
import type { ConnectorProvider, ImportedItem, WritableConnector } from '@docket/boundaries';
import { and, eq, isNull } from 'drizzle-orm';

import type { IntegrationRow } from './integration-provider';

/** Count of each reconciliation action performed by one sync. */
export interface ReconcileTally {
  inserted: number;
  pulled: number;
  pushed: number;
  deleted: number;
  archived: number;
  created: number;
}

/** Options for syncing imported items into linked tasks. */
export interface ReconcileOptions {
  /** Actor to assign newly-created linked tasks to, or null for unassigned triage. */
  readonly assigneeId: string | null;
  /** Writable connector capability for two-way sync, when the provider supports it. */
  readonly writable: WritableConnector | null;
  /** Provider for any write-back calls. */
  readonly provider: ConnectorProvider;
}

function zero(): ReconcileTally {
  return { inserted: 0, pulled: 0, pushed: 0, deleted: 0, archived: 0, created: 0 };
}

function itemDate(value: string | undefined): Date | null {
  return value ? new Date(value) : null;
}

function itemState(item: ImportedItem, defaultState: string): string {
  return item.completed ? 'done' : defaultState;
}

async function defaultStateForTeam(orgId: string, teamId: string): Promise<string> {
  const rows = await db
    .select({ workflowStates: team.workflowStates })
    .from(team)
    .where(and(eq(team.id, teamId), eq(team.organizationId, orgId)))
    .limit(1);
  return rows[0]?.workflowStates[0]?.key ?? 'backlog';
}

async function pushDirtyLocalTasks(
  row: IntegrationRow,
  opts: ReconcileOptions,
  tally: ReconcileTally,
): Promise<void> {
  if (!row.writeBack || !opts.writable) return;
  const dirtyRows = await db
    .select()
    .from(task)
    .where(
      and(
        eq(task.organizationId, row.organizationId),
        eq(task.source, 'linked'),
        eq(task.sourceIntegrationId, row.id),
        isNull(task.archivedAt),
      ),
    );

  for (const local of dirtyRows) {
    if (!local.externalId || !local.externalUpdatedAt || !local.externalListId) continue;
    if (local.updatedAt.getTime() <= local.externalUpdatedAt.getTime()) continue;

    const result = await opts.writable.pushTask({
      connectionId: row.id,
      provider: opts.provider,
      op: {
        kind: 'update',
        listId: local.externalListId,
        externalId: local.externalId,
        ...(local.externalEtag ? { etag: local.externalEtag } : {}),
        title: local.title,
        notes: local.description,
        dueDate: local.dueDate?.toISOString() ?? null,
        completed: Boolean(local.completedAt),
      },
    });
    if (!result) continue;

    const stamp = new Date(result.externalUpdatedAt);
    await db
      .update(task)
      .set({
        externalId: result.externalId,
        externalUpdatedAt: stamp,
        externalEtag: result.externalEtag ?? local.externalEtag,
        lastPushedAt: stamp,
        updatedAt: stamp,
      })
      .where(eq(task.id, local.id));
    tally.pushed += 1;
  }
}

/**
 * Reconcile imported connector items into Docket linked tasks.
 *
 * @param orgId - The organization receiving the sync.
 * @param actorId - The actor running the sync, recorded as creator for new tasks.
 * @param row - The integration being reconciled.
 * @param teamId - The destination team for new linked tasks.
 * @param items - The provider snapshot/tombstones.
 * @param opts - Assignment and write-back options.
 * @returns action counts used for sync-run processed totals.
 */
export async function reconcileTasks(
  orgId: string,
  actorId: string,
  row: IntegrationRow,
  teamId: string,
  items: readonly ImportedItem[],
  opts: ReconcileOptions,
): Promise<ReconcileTally> {
  const tally = zero();
  await pushDirtyLocalTasks(row, opts, tally);

  const defaultState = await defaultStateForTeam(orgId, teamId);
  for (const item of items) {
    const externalId = item.provenance.externalId;
    const existingRows = await db
      .select()
      .from(task)
      .where(
        and(
          eq(task.organizationId, orgId),
          eq(task.source, 'linked'),
          eq(task.sourceIntegrationId, row.id),
          eq(task.externalId, externalId),
        ),
      )
      .limit(1);
    const existing = existingRows[0];

    if (item.removed) {
      if (existing && !existing.archivedAt) {
        await db.update(task).set({ archivedAt: new Date() }).where(eq(task.id, existing.id));
        tally.archived += 1;
      }
      continue;
    }

    const externalUpdatedAt = itemDate(item.provenance.externalUpdatedAt);
    if (!existing) {
      const initialUpdatedAt = externalUpdatedAt ?? new Date();
      await db.insert(task).values({
        organizationId: orgId,
        title: item.title,
        description: item.body ?? null,
        teamId,
        state: itemState(item, defaultState),
        dueDate: item.dueDate ? new Date(item.dueDate) : null,
        ...(opts.assigneeId !== null ? { assigneeId: opts.assigneeId } : {}),
        source: 'linked',
        sourceIntegrationId: row.id,
        externalId,
        externalUrl: item.provenance.externalUrl ?? null,
        sourceSyncMode: 'mirror',
        externalUpdatedAt,
        externalEtag: item.provenance.externalEtag ?? null,
        externalListId: item.provenance.externalListId ?? null,
        createdBy: actorId,
        updatedAt: initialUpdatedAt,
      });
      tally.inserted += 1;
      continue;
    }

    if (!externalUpdatedAt) continue;
    const storedExternal = existing.externalUpdatedAt?.getTime() ?? 0;
    if (externalUpdatedAt.getTime() <= storedExternal) continue;

    await db
      .update(task)
      .set({
        title: item.title,
        description: item.body ?? null,
        dueDate: item.dueDate ? new Date(item.dueDate) : null,
        state: itemState(item, existing.state),
        externalUrl: item.provenance.externalUrl ?? existing.externalUrl,
        externalUpdatedAt,
        externalEtag: item.provenance.externalEtag ?? existing.externalEtag,
        externalListId: item.provenance.externalListId ?? existing.externalListId,
        updatedAt: externalUpdatedAt,
      })
      .where(eq(task.id, existing.id));
    tally.pulled += 1;
  }

  return tally;
}
