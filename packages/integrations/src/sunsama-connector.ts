/**
 * `@docket/integrations` — the Sunsama → `ImportedItem` connector-shaped adapter.
 *
 * @remarks
 * `./sunsama.ts` only reads; `./sunsama-mapping.ts` only maps field-by-field. Neither produces
 * anything the app layer's write path understands. This module is the missing third piece: it
 * turns a {@link SunsamaTask} into the exact {@link ImportedItem} shape
 * `apps/api/src/routes/integration-reconcile.ts`'s `reconcileTasks` already knows how to write —
 * the same shape `notion-mapping.ts#mapNotionPage` and the Google Tasks/GitHub/Linear adapters
 * produce — so a migrated Sunsama task gets real provenance (`task.source_integration_id` +
 * `task.external_id`) instead of the untraceable rows the public `POST /tasks` endpoint would
 * create. That provenance is what makes a second run idempotent: `reconcileTasks` recognizes an
 * item it already wrote (`sourceIntegrationId` + `externalId` matches a `linked` task) and
 * no-ops instead of duplicating it. See `docs/migration/sunsama-to-docket.md` §5 for the run that
 * proves this on the committed fixture.
 *
 * **This is deliberately NOT a `ConnectorProviderClient`.** Docket's connector abstraction
 * (`connect()` / OAuth / `provider-catalog.ts` / the Connections wizard / background sync) is for
 * providers Docket keeps talking to. Sunsama is a one-time **migration** — `integration.pattern`
 * is `'migration'`, never `'connector'` — so this module exports plain functions that produce
 * `ImportedItem[]` for a caller to hand `reconcileTasks` directly, exactly once, with no `connect`
 * step, no listed containers, and — this is the important part — no entry anywhere in
 * `provider-catalog.ts`'s `CONNECTOR_PROVIDER_IDS`/`PROVIDER_CATALOG`. Adding one would wire an
 * OAuth sign-in affordance for a provider that has none and never will, and would let a user
 * "connect" Sunsama from the Connections UI as if it were an ongoing sync — the opposite of what
 * "migration, not connector" means in this codebase (see `docs/migration/sunsama-to-docket.md` §5
 * and `packages/types/src/integration.ts`'s `IntegrationPattern` doc).
 *
 * **Fields this adapter cannot carry through.** `ImportedItem` only has
 * `title`/`body`/`completed`/`dueDate` plus provenance — there is no `startDate` or
 * `estimateMinutes`, and `reconcileTasks`'s `insertLinked`/`applyPull` do not write them even
 * where the column exists on `task`. So `SunsamaTask.plannedDate` (→ `task.startDate`) and
 * `SunsamaTask.timeEstimateMinutes` (→ `task.estimateMinutes`) — both documented destinations in
 * `SUNSAMA_FIELD_MAPPING` — are NOT persisted by a run through this adapter today, and neither are
 * per-task subtasks as child rows (`ImportedItem` has no parent-task linkage at all). This is a
 * limitation of the shared `ImportedItem`/`reconcileTasks` contract every connector adapter
 * shares, not something specific to Sunsama, and closing it means extending that shared contract —
 * out of scope here (`integration-reconcile.ts` is off-limits to this change). `mapSunsamaTask`'s
 * `MappedSunsamaTask` still carries the true values ({@link SunsamaImportedTask.notWrittenByReconciler}
 * surfaces them here too) so a future write path has everything it needs without re-deriving it.
 */
import type { ImportedItem, ItemProvenance, ConnectorProvider } from './connector';
import {
  mapSunsamaTask,
  type DocketWorkspaceName,
  type SunsamaWorkspaceRouting,
} from './sunsama-mapping';
import type { SunsamaTask } from './sunsama';

/**
 * The committed routing declaration: which Sunsama stream lands in which of the eight workspaces.
 *
 * @remarks
 * Declared here — in the package, alongside the mapping it configures — rather than in
 * `scripts/import-sunsama.ts`, so both the CLI and a test that needs to prove the ACTUAL
 * production routing (not a stand-in approximation) can import the same constant; TypeScript's
 * per-package `rootDir` means a `apps/api` test cannot reach into `scripts/` directly. Declared
 * BEFORE any run, which is the point: `expectedFallbackTaskCount` states up front how many tasks
 * are allowed to fall through to the fallback workspace, and the run fails if reality disagrees —
 * so "everything ended up in one catch-all" cannot be discovered after the fact. Stream ids are
 * the fixture account's; a live run adds the real ids alongside them (matching is by id first,
 * then by name, so a name-only entry works before ids are known).
 */
export const SUNSAMA_ROUTING: SunsamaWorkspaceRouting = {
  label: 'Sunsama → Docket, 2026-08',
  routes: [
    { streamId: 'str-transit', workspace: 'Las Vegans for Better Transit' },
    { streamName: 'Las Vegans for Better Transit', workspace: 'Las Vegans for Better Transit' },
    { streamId: 'str-newsletter', workspace: 'The Willie Diaries' },
    { streamName: 'Weekly newsletter', workspace: 'The Willie Diaries' },
    { streamId: 'str-personal', workspace: 'Personal Life' },
    { streamName: 'Personal', workspace: 'Personal Life' },
    { streamId: 'str-docket', workspace: 'Hypertext Studio' },
    { streamName: 'Docket', workspace: 'Hypertext Studio' },
    { streamName: 'Reasonable Tech', workspace: 'Reasonable Tech Company' },
    { streamName: 'Rebuilding America', workspace: 'Rebuilding America Project' },
    { streamName: 'Oasis', workspace: 'Project Oasis' },
    {
      streamName: 'Vibe Code Cleanup',
      workspace: 'Willie Enterprises (dba Vibe Code Cleanup Company)',
    },
  ],
  fallbackWorkspace: 'Personal Life',
  // The fixture account has exactly one stream-less task. A live run that produces a different
  // number stops here rather than quietly dumping work into the fallback.
  expectedFallbackTaskCount: 1,
};

/**
 * The provenance provider tag stamped on every Sunsama-derived {@link ImportedItem}.
 *
 * @remarks
 * `'sunsama'` is deliberately NOT a member of `ConnectorProviderId` (see this module's top
 * doc — Sunsama is `migration`-pattern, never `connector`), so it cannot be assigned to
 * {@link ItemProvenance.provider} without a cast. That is safe here for the same reason
 * `integration-reconcile.ts`'s own `asProvider` helper carries an arbitrary stored
 * `integration.provider` string through the identical field: nothing downstream — not
 * `reconcileTasks`, not `toTaskOut`'s serializer — reads `ImportedItem.provenance.provider` for
 * anything beyond display (verified by grep: no production code path branches on it). It exists
 * on the row only as an audit trail of which system produced the import.
 */
export const SUNSAMA_PROVENANCE_PROVIDER = 'sunsama' as ConnectorProvider;

/** One Sunsama task, mapped to the shape `reconcileTasks` can write, plus what it still can't. */
export interface SunsamaImportedTask {
  /** The destination workspace this task was routed to. */
  readonly workspace: DocketWorkspaceName;
  /** The connector-shaped item, ready for `reconcileTasks`. */
  readonly item: ImportedItem;
  /**
   * Fields {@link SUNSAMA_FIELD_MAPPING} documents a Docket destination for for, but that
   * {@link SunsamaImportedTask.item}'s `ImportedItem` shape has no field for and the shared
   * `reconcileTasks` write path does not persist — preserved here (not silently dropped) so a
   * caller building the migration report, or a future write path, still has them.
   */
  readonly notWrittenByReconciler: {
    /** `task.startDate` (Sunsama's planned day) — see this module's top doc. */
    readonly startDate: string | null;
    /** `task.estimateMinutes` — see this module's top doc. */
    readonly estimateMinutes: number | null;
    /** How many subtasks existed on the source task (not written as child rows). */
    readonly subtaskCount: number;
  };
}

/**
 * Map one normalized Sunsama task onto the `ImportedItem` `reconcileTasks` writes.
 *
 * @remarks
 * Reuses {@link mapSunsamaTask} (and, transitively, {@link SUNSAMA_FIELD_MAPPING}) rather than
 * re-deriving any field decision — this function only reshapes an already-mapped task into the
 * connector port's envelope.
 *
 * @param task - The normalized Sunsama task.
 * @param routing - The validated workspace-routing declaration.
 * @param importedAt - ISO-8601 timestamp stamped onto the item's provenance.
 */
export function sunsamaTaskToImportedItem(
  task: SunsamaTask,
  routing: SunsamaWorkspaceRouting,
  importedAt: string,
): SunsamaImportedTask {
  const mapped = mapSunsamaTask(task, routing);

  const provenance: ItemProvenance = {
    provider: SUNSAMA_PROVENANCE_PROVIDER,
    externalId: mapped.externalId,
    importedAt,
    ...(mapped.externalUrl !== null ? { externalUrl: mapped.externalUrl } : {}),
    ...(mapped.externalUpdatedAt !== null ? { externalUpdatedAt: mapped.externalUpdatedAt } : {}),
  };

  const item: ImportedItem = {
    id: mapped.externalId,
    // 'issue' is the closest ImportedItem `kind` to a Sunsama task — the same choice
    // `mapNotionPage` makes for a Notion task page (see notion-mapping.ts).
    kind: 'issue',
    title: mapped.title,
    ...(mapped.description !== null ? { body: mapped.description } : {}),
    completed: mapped.completed,
    dueDate: mapped.dueDate,
    provenance,
  };

  return {
    workspace: mapped.workspace,
    item,
    notWrittenByReconciler: {
      startDate: mapped.startDate,
      estimateMinutes: mapped.estimateMinutes,
      subtaskCount: mapped.children.length,
    },
  };
}

/**
 * Map every active task in a read account onto {@link SunsamaImportedTask}s.
 *
 * @param tasks - The account's active (non-archived) tasks.
 * @param routing - The validated workspace-routing declaration.
 * @param importedAt - ISO-8601 timestamp stamped onto every item's provenance.
 */
export function sunsamaAccountToImportedItems(
  tasks: readonly SunsamaTask[],
  routing: SunsamaWorkspaceRouting,
  importedAt: string,
): readonly SunsamaImportedTask[] {
  return tasks.map((task) => sunsamaTaskToImportedItem(task, routing, importedAt));
}

/**
 * Group mapped Sunsama items by destination workspace, preserving first-seen workspace order.
 *
 * @remarks
 * `reconcileTasks` reconciles one (org, team) at a time, and in Docket each of the eight named
 * workspaces is its own organization — so a caller writing the migration needs the tasks split
 * per destination workspace to reconcile each group into the right org/team. Pure grouping only;
 * resolving a workspace name to a real `orgId`/`teamId` is the caller's job.
 *
 * @param mapped - The account's mapped tasks (e.g. from {@link sunsamaAccountToImportedItems}).
 */
export function groupSunsamaImportedItemsByWorkspace(
  mapped: readonly SunsamaImportedTask[],
): ReadonlyMap<DocketWorkspaceName, readonly ImportedItem[]> {
  const groups = new Map<DocketWorkspaceName, ImportedItem[]>();
  for (const entry of mapped) {
    const bucket = groups.get(entry.workspace);
    if (bucket) bucket.push(entry.item);
    else groups.set(entry.workspace, [entry.item]);
  }
  return groups;
}
