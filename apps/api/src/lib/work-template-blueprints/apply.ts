import { taskDependency } from '@docket/db';
import { BlueprintError } from '@docket/work/blueprints';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { trackedFields, type RecordedChange } from '../../mcp/change-set';
import { insertPreparedOrdinaryWork } from '../work-creation/ordinary-insert';
import { insertWorkRow } from '../work-creation/writers';
import type { InsertedWork } from '../work-creation/writers';
import type { OrdinaryWorkMutation } from '../work-creation/types';
import type { TemplateTransaction } from '../templates/persistence';
import type { PreparedBlueprintCreation } from './preflight';

/** Insert a completely preflighted tree and its edges with no nested expansion or receipt. */
export async function applyPreparedBlueprintCreation(
  tx: TemplateTransaction,
  prepared: PreparedBlueprintCreation,
): Promise<OrdinaryWorkMutation> {
  const snapshots = [prepared.graph.root, ...prepared.graph.publications];
  const allowlist = snapshots.map((row) => ({
    workTypeId: row.workTypeId,
    versionId: row.versionId,
  }));
  // Exact immutable pairs were authorized and locked by the closure; no client archive flag exists.
  await tx.execute(
    sql`SELECT set_config('docket.work_template_authorized_archived_versions', ${JSON.stringify(allowlist)}, true)`,
  );
  const mutations: OrdinaryWorkMutation[] = [];
  const inserted = new Map<string, InsertedWork>();
  for (const entry of prepared.entries) {
    const mutation =
      entry.kind === 'existing'
        ? { root: entry.work, created: [], changes: [], effects: [], parentTaskIds: [] }
        : entry.kind === 'ordinary'
          ? await insertPreparedOrdinaryWork(tx, entry.prepared)
          : checkpointMutation(await insertWorkRow(tx, entry.insert));
    inserted.set(JSON.stringify(entry.allocated.node.path), mutation.root);
    mutations.push(mutation);
  }
  const dependencyChanges = await insertBlueprintDependencies(tx, prepared, inserted);
  const first = mutations[0];
  if (!first)
    throw new BlueprintError('blueprint_invalid', 'A creation requires its selected root.');
  return {
    root: first.root,
    created: mutations.flatMap((mutation) => mutation.created),
    changes: [...mutations.flatMap((mutation) => mutation.changes), ...dependencyChanges],
    effects: mutations.flatMap((mutation) => mutation.effects),
    parentTaskIds: settlementParents(prepared, mutations),
  };
}

function settlementParents(
  prepared: PreparedBlueprintCreation,
  mutations: readonly OrdinaryWorkMutation[],
): (string | null)[] {
  const preserved = new Set(
    (prepared.context.existingNodes ?? [])
      .filter(
        (node) => node.kind === 'task' && (node.state === 'completed' || node.state === 'canceled'),
      )
      .map((node) => node.id),
  );
  return mutations
    .flatMap((mutation) => mutation.parentTaskIds)
    .filter((id) => id === null || !preserved.has(id));
}

function checkpointMutation(work: InsertedWork): OrdinaryWorkMutation {
  return {
    root: work,
    created: [work],
    changes: [
      { kind: work.kind, id: work.id, op: 'create', after: trackedFields(work.kind, work.row) },
    ],
    effects: [{ kind: 'search', dedupeKey: `search:${work.kind}:${work.id}`, work }],
    parentTaskIds: [],
  };
}

async function insertBlueprintDependencies(
  tx: TemplateTransaction,
  prepared: PreparedBlueprintCreation,
  inserted: ReadonlyMap<string, InsertedWork>,
): Promise<RecordedChange[]> {
  const values: (typeof taskDependency.$inferInsert)[] = [];
  const changes: RecordedChange[] = [];
  const existing = await existingDependencies(tx, prepared, inserted);
  for (const edge of prepared.tree.dependencies) {
    const blocker = inserted.get(JSON.stringify(edge.blockerPath));
    const blocked = inserted.get(JSON.stringify(edge.blockedPath));
    if (blocker?.kind !== 'task' || blocked?.kind !== 'task')
      throw new BlueprintError('blueprint_invalid', 'A dependency requires both selected Tasks.');
    if (existing.has(JSON.stringify([blocker.id, blocked.id]))) continue;
    values.push({
      organizationId: prepared.command.caller.orgId,
      blockingTaskId: blocker.id,
      blockedTaskId: blocked.id,
    });
    changes.push({ kind: 'blocks', from: blocker.id, to: blocked.id, linked: true });
  }
  if (values.length) await tx.insert(taskDependency).values(values);
  return changes;
}

async function existingDependencies(
  tx: TemplateTransaction,
  prepared: PreparedBlueprintCreation,
  inserted: ReadonlyMap<string, InsertedWork>,
): Promise<ReadonlySet<string>> {
  if (!prepared.entries.some((entry) => entry.kind === 'existing')) return new Set();
  const ids = [...inserted.values()].flatMap((work) => (work.kind === 'task' ? [work.id] : []));
  if (!ids.length) return new Set();
  const rows = await tx
    .select()
    .from(taskDependency)
    .where(
      and(
        eq(taskDependency.organizationId, prepared.command.caller.orgId),
        inArray(taskDependency.blockingTaskId, ids),
        inArray(taskDependency.blockedTaskId, ids),
      ),
    );
  return new Set(rows.map((row) => JSON.stringify([row.blockingTaskId, row.blockedTaskId])));
}
