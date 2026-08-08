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
 * **Every documented destination is on the write path.** `ImportedItem` carries
 * `startDate`/`estimateMinutes`/`parentExternalId` alongside `title`/`body`/`completed`/`dueDate`
 * (the shared-contract extension `docs/migration/sunsama-to-docket.md` §5.3 used to name as the
 * one remaining field gap), so `SunsamaTask.plannedDate` (→ `task.startDate`),
 * `SunsamaTask.timeEstimateMinutes` (→ `task.estimateMinutes`), and each subtask (→ its own child
 * `task` row via `parentExternalId`) all persist through `reconcileTasks` exactly as
 * `SUNSAMA_FIELD_MAPPING` declares. A subtask becomes a sibling {@link ImportedItem} on
 * {@link SunsamaImportedTask.childItems}, keyed by Sunsama's own subtask id when it supplied one
 * and by a stable `<parent>/subtask-<n>` id otherwise, so a re-run reconciles children as
 * idempotently as parents.
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

/** One Sunsama task, mapped to the shape `reconcileTasks` writes. */
export interface SunsamaImportedTask {
  /** The destination workspace this task was routed to. */
  readonly workspace: DocketWorkspaceName;
  /** The connector-shaped item, ready for `reconcileTasks`. */
  readonly item: ImportedItem;
  /**
   * One item per Sunsama subtask, each carrying `parentExternalId` back to
   * {@link SunsamaImportedTask.item} so `reconcileTasks` writes it as a child `task` row
   * (`task.parentTaskId`) with its own completion state. Children always land in the parent's
   * workspace — Sunsama has no per-subtask stream.
   */
  readonly childItems: readonly ImportedItem[];
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
    startDate: mapped.startDate,
    estimateMinutes: mapped.estimateMinutes,
    provenance,
  };

  const childItems: ImportedItem[] = mapped.children.map((child, index) => {
    // Sunsama's own subtask id when it supplied one, else a synthesized id that is stable for an
    // unchanged source (position-keyed) — either way a re-run matches the same linked child row
    // and no-ops instead of duplicating it.
    const childExternalId = child.id ?? `${mapped.externalId}/subtask-${String(index + 1)}`;
    return {
      id: childExternalId,
      kind: 'issue',
      title: child.title,
      completed: child.completed,
      parentExternalId: mapped.externalId,
      provenance: {
        provider: SUNSAMA_PROVENANCE_PROVIDER,
        externalId: childExternalId,
        importedAt,
        // Sunsama subtasks carry no modification time of their own; the parent's is the closest
        // honest anchor, and it keeps a child born clean exactly as its parent is.
        ...(mapped.externalUpdatedAt !== null
          ? { externalUpdatedAt: mapped.externalUpdatedAt }
          : {}),
      },
    };
  });

  return { workspace: mapped.workspace, item, childItems };
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
 * per destination workspace to reconcile each group into the right org/team. Each entry's
 * `childItems` land in the same bucket as (and after) their parent, so one `reconcileTasks` call
 * per workspace sees the whole family and can link `task.parentTaskId`. Pure grouping only;
 * resolving a workspace name to a real `orgId`/`teamId` is the caller's job.
 *
 * @param mapped - The account's mapped tasks (e.g. from {@link sunsamaAccountToImportedItems}).
 */
export function groupSunsamaImportedItemsByWorkspace(
  mapped: readonly SunsamaImportedTask[],
): ReadonlyMap<DocketWorkspaceName, readonly ImportedItem[]> {
  const groups = new Map<DocketWorkspaceName, ImportedItem[]>();
  for (const entry of mapped) {
    const bucket = groups.get(entry.workspace) ?? [];
    bucket.push(entry.item, ...entry.childItems);
    groups.set(entry.workspace, bucket);
  }
  return groups;
}
