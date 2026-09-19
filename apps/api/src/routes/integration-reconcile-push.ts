/**
 * `@docket/api` — the write-back half of two-way connector task sync.
 *
 * @remarks
 * Pushes local edits, deletes and new native tasks to a writable provider, and stores the anchors
 * the provider echoes back so the next pass sees each task as clean. {@link reconcileTasks} in
 * `./integration-reconcile` decides which tasks to push; this module performs the pushes.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { db, task } from '@docket/db';
import { isProviderMissingObjectError } from '@docket/connections/provider-error';
import type {
  ConnectorProvider,
  ExternalWriteResult,
  ImportedItem,
  WritableConnector,
} from '@docket/integrations';

import { enqueueSearchUpsert } from '../search/write-through';

import type { IntegrationRow } from './integration-provider';
import type { ReconcileResult, ReconcileStatuses } from './integration-reconcile';
import {
  descriptionHash,
  fullRemoteBody,
  type ReconcileLocalTask,
  type TaskSyncConflict,
} from './integration-reconcile-plan';
import { recordSyncConflict } from './sync-notion';

/** The tallies a reconcile pass accumulates before returning them as a {@link ReconcileResult}. */
export type ReconcileTally = { -readonly [K in keyof ReconcileResult]: ReconcileResult[K] };

/**
 * Count what a push reported about the task's long-form content.
 *
 * @param tally - The pass's tallies.
 * @param state - The push's content outcome.
 */
export function countWriteContent(
  tally: ReconcileTally,
  state: ExternalWriteResult['contentState'],
): void {
  if (state === 'written') tally.contentWritten += 1;
  if (state === 'inaccessible') tally.contentInaccessible += 1;
  if (state === 'rejected') tally.contentRejected += 1;
}

/** How far past its anchor a task's `updatedAt` is left when its content still awaits access. */
const CONTENT_RETRY_OFFSET_MS = 1;

/**
 * The sync anchors to store after a push.
 *
 * @remarks
 * `updatedAt = externalUpdatedAt` marks the task clean. When the provider refused the task's
 * long-form content for lack of access, `updatedAt` is left {@link CONTENT_RETRY_OFFSET_MS} ahead
 * instead, so the task stays dirty and a later pass sends the content again, which lands once
 * access is granted. The body anchor advances only when the provider's copy now matches the
 * description: a refused body keeps the old anchor, so the next edit to the task tries it again.
 */
function pushedAnchors(result: ExternalWriteResult, description: string | null) {
  const anchor = new Date(result.externalUpdatedAt);
  const refused = result.contentState === 'inaccessible' || result.contentState === 'rejected';
  return {
    externalEtag: result.externalEtag ?? null,
    lastPushedAt: anchor,
    externalUpdatedAt: anchor,
    updatedAt:
      result.contentState === 'inaccessible'
        ? new Date(anchor.getTime() + CONTENT_RETRY_OFFSET_MS)
        : anchor,
    ...(refused ? {} : { externalBodyHash: descriptionHash(description) }),
  };
}

/** Whether a task's only unpushed change is long-form content the provider refused for access. */
function awaitsContentAccess(local: ReconcileLocalTask): boolean {
  return (
    local.externalUpdatedAt !== null &&
    local.updatedAt.getTime() === local.externalUpdatedAt.getTime() + CONTENT_RETRY_OFFSET_MS
  );
}

/** A body the provider changed and Docket did not, which a contested push keeps. */
interface KeptBody {
  /** The provider's body, which becomes the task's description. */
  readonly description: string | null;
}

/**
 * The provider's body, when only the provider changed it since the last sync.
 *
 * @param local - The task about to be pushed.
 * @param remote - The provider's item.
 * @returns the body to keep, or `undefined` when Docket changed the description, the provider's
 *   body is unchanged, or the provider could not hand it over in full.
 */
function remoteOnlyBody(local: ReconcileLocalTask, remote: ImportedItem): KeptBody | undefined {
  if (remote.bodyUnavailable === true) return undefined;
  if (local.externalBodyHash !== descriptionHash(local.description)) return undefined;
  const description = fullRemoteBody(remote);
  return descriptionHash(description) === local.externalBodyHash ? undefined : { description };
}

/** What one reconcile pass shares with each local edit it pushes. */
export interface PushPass {
  readonly orgId: string;
  readonly actorId: string;
  readonly row: IntegrationRow;
  readonly writable: WritableConnector;
  readonly tally: ReconcileTally;
}

/**
 * Push one dirty task, recording a lost remote edit first, and count the outcome.
 *
 * @remarks
 * On a contested push, a body only the provider changed is kept: the task takes the provider's
 * body and the provider's copy is left as it is, so neither side's edit is lost. While the
 * provider refuses long-form content for lack of access, one content retry per pass is sent and the
 * rest wait for a pass where access works, so a connection without content access does not re-push
 * every refused task on every sweep.
 *
 * @param pass - The pass's shared state.
 * @param local - The task to push.
 * @param conflict - The remote values Docket is about to overwrite, when both sides changed.
 * @param remote - The provider's item for this task, or `undefined` when its read did not return it.
 */
export async function pushLocalEdit(
  pass: PushPass,
  local: ReconcileLocalTask,
  conflict: TaskSyncConflict | undefined,
  remote: ImportedItem | undefined,
): Promise<void> {
  const { orgId, actorId, row, writable, tally } = pass;
  if (tally.contentInaccessible > 0 && awaitsContentAccess(local)) return;
  const kept = conflict && remote ? remoteOnlyBody(local, remote) : undefined;
  // Record the losing remote value BEFORE overwriting it — see `recordSyncConflict`.
  if (conflict) {
    const lost = kept === undefined ? conflict : { ...conflict, remoteBody: null };
    await recordSyncConflict({
      orgId,
      actorId,
      integrationId: row.id,
      provider: row.provider,
      taskId: local.id,
      conflict: lost,
    });
    tally.conflicts += 1;
  }
  const pushed = await pushUpdate(row, withKeptBody(local, kept), writable, {
    absent: remote === undefined,
    keepsRemoteBody: kept !== undefined,
  });
  if (pushed === 'missing') return;
  countWriteContent(tally, pushed);
  await enqueueSearchUpsert(orgId, 'task', local.id);
  tally.pushed += 1;
}

/** The task as it is pushed once a kept provider body has replaced its description. */
function withKeptBody(local: ReconcileLocalTask, kept: KeptBody | undefined): ReconcileLocalTask {
  if (kept === undefined) return local;
  return {
    ...local,
    description: kept.description,
    externalBodyHash: descriptionHash(kept.description),
  };
}

/** A push that found no page at the provider, for a task missing from a changed-rows-only read. */
type PushOutcome = ExternalWriteResult['contentState'] | 'missing';

/** How {@link pushUpdate} treats one task. */
interface PushUpdateOptions {
  /** Whether the provider's read did not return this task. */
  readonly absent: boolean;
  /** Whether the task's description is the provider's body, to be stored as the push lands. */
  readonly keepsRemoteBody: boolean;
}

/**
 * Push a dirty local task's fields to the provider and restamp the anchors from the echo.
 *
 * @remarks
 * The description is marked unchanged when it still matches the body anchor, so a provider that
 * stores long-form content apart leaves its copy alone. A title edit on a task whose Notion page
 * Docket could only read in part therefore cannot replace that page with the partial copy.
 *
 * @returns what happened to the task's long-form content, or `'missing'` when an absent task's item
 *   no longer exists at the provider (unshared or deleted) and nothing was written.
 * @throws When the provider rejects the write for any other reason.
 */
async function pushUpdate(
  row: IntegrationRow,
  local: ReconcileLocalTask,
  writable: WritableConnector,
  { absent, keepsRemoteBody }: PushUpdateOptions,
): Promise<PushOutcome> {
  const listId = local.externalListId ?? '@default';
  const notesUnchanged = local.externalBodyHash === descriptionHash(local.description);
  let result: ExternalWriteResult | undefined;
  try {
    result = await writable.pushTask({
      connectionId: row.id,
      provider: asProvider(row.provider),
      op: {
        kind: 'update',
        listId,
        externalId: local.externalId,
        ...(local.externalEtag ? { etag: local.externalEtag } : {}),
        title: local.title,
        notes: local.description,
        ...(notesUnchanged ? { notesUnchanged: true as const } : {}),
        dueDate: local.dueDate ? local.dueDate.toISOString() : null,
        completed: local.stateType === 'completed',
      },
    });
  } catch (error) {
    // The read had no row for it, so a missing item is one the sync cannot reach any more. It is
    // left as it was, the same as before absent rows were pushed, rather than failing every task.
    if (absent && isProviderMissingObjectError(error)) return 'missing';
    throw error;
  }
  if (!result) return undefined;
  await db
    .update(task)
    .set({
      ...pushedAnchors(result, local.description),
      ...(keepsRemoteBody ? { description: local.description } : {}),
    })
    .where(eq(task.id, local.id));
  return result.contentState;
}

/**
 * Delete a locally-canceled task at the provider and mark the local row clean.
 *
 * @param local - The canceled task.
 * @param writable - The provider's write-back seam.
 * @param provider - The integration's provider.
 */
export async function pushDelete(
  local: ReconcileLocalTask,
  writable: WritableConnector,
  provider: string,
): Promise<void> {
  await writable.pushTask({
    connectionId: local.externalListId ?? local.id,
    provider: asProvider(provider),
    op: {
      kind: 'delete',
      listId: local.externalListId ?? '@default',
      externalId: local.externalId,
    },
  });
  const now = new Date();
  await db
    .update(task)
    .set({ lastPushedAt: now, externalUpdatedAt: now, updatedAt: now })
    .where(eq(task.id, local.id));
}

/** The reconcile pass's shared state that {@link pushNativeCreates} reads and reports into. */
export interface NativeCreateContext {
  /** The team whose native tasks are pushed. */
  readonly teamId: string;
  /** The provider container new tasks are created in. */
  readonly defaultListId: string;
  /** The statuses the pass maps completion through. */
  readonly keys: ReconcileStatuses;
  /** Records what happened to each created task's long-form content. */
  readonly countContent: (state: ExternalWriteResult['contentState']) => void;
}

/**
 * Push every native task in the target team with no external id out as a new provider task.
 *
 * @returns how many tasks were created at the provider.
 */
export async function pushNativeCreates(
  orgId: string,
  row: IntegrationRow,
  writable: WritableConnector,
  { teamId, defaultListId, keys, countContent }: NativeCreateContext,
): Promise<number> {
  const natives = await db
    .select()
    .from(task)
    .where(
      and(
        eq(task.organizationId, orgId),
        eq(task.teamId, teamId),
        eq(task.source, 'native'),
        isNull(task.externalId),
      ),
    );
  let created = 0;
  for (const t of natives) {
    const result = await writable.pushTask({
      connectionId: row.id,
      provider: asProvider(row.provider),
      op: {
        kind: 'create',
        listId: defaultListId,
        title: t.title,
        notes: t.description,
        dueDate: t.dueDate ? t.dueDate.toISOString() : null,
        completed: keys.typeOf(t.state) === 'completed',
      },
    });
    if (!result) continue;
    countContent(result.contentState);
    await db
      .update(task)
      .set({
        source: 'linked',
        sourceIntegrationId: row.id,
        sourceSyncMode: 'mirror',
        externalId: result.externalId,
        externalListId: defaultListId,
        ...pushedAnchors(result, t.description),
      })
      .where(eq(task.id, t.id));
    await enqueueSearchUpsert(orgId, 'task', t.id);
    created += 1;
  }
  return created;
}

/** Narrow a stored provider string for the connector push input (already validated upstream). */
function asProvider(provider: string): ConnectorProvider {
  return provider as ConnectorProvider;
}
