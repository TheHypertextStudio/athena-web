import { createHash } from 'node:crypto';
import { taskDependency } from '@docket/db';
import { BlueprintError } from '@docket/work/blueprints';
import { and, eq, inArray, or } from 'drizzle-orm';
import type { TemplateTransaction } from '../templates/persistence';
import { authorizeBlueprintRows, snapshotCaller, retainedSnapshotFilter } from './snapshot-access';
import { snapshotContext, snapshotMetadata } from './snapshot-context';
import { mapBlueprintNodes } from './snapshot-map';
import { selectBlueprintSnapshotRows } from './snapshot-selection';
import { snapshotDateReferences } from './snapshot-references';
import { labelsForSubjects } from '../labels';
import { LabelId } from '@docket/work/ids';
import { discoverBlueprintRows, readBlueprintWork } from './snapshot-rows';
import type {
  AuthorizedBlueprintSnapshot,
  BlueprintSnapshotAuthority,
  BlueprintSnapshotOptions,
  BlueprintSnapshotRow,
  BlueprintWorkRef,
} from './snapshot-types';
import { nativeScheduleSnapshotFilter } from '../recurrence/schedule-native-facts';
export type {
  AuthorizedBlueprintSnapshot,
  BlueprintStoredWork,
  BlueprintWorkRef,
  BlueprintSnapshotOptions,
} from './snapshot-types';

async function lockSnapshot(
  tx: TemplateTransaction,
  orgId: string,
  discovered: readonly BlueprintSnapshotRow[],
  discover: () => Promise<BlueprintSnapshotRow[]>,
): Promise<BlueprintSnapshotRow[]> {
  for (const { work } of [...discovered].sort((a, b) =>
    `${a.work.kind}:${a.work.id}`.localeCompare(`${b.work.kind}:${b.work.id}`),
  ))
    await readBlueprintWork(tx, orgId, work, true);
  const locked = await discover();
  const membership = (rows: readonly BlueprintSnapshotRow[]) =>
    JSON.stringify(rows.map(({ work, parent }) => [work.kind, work.id, parent]).sort());
  if (membership(discovered) !== membership(locked))
    throw new BlueprintError('blueprint_invalid', 'Work containment changed; review it again.');
  return locked;
}
async function withTaskLabels(
  tx: TemplateTransaction,
  orgId: string,
  nodes: AuthorizedBlueprintSnapshot['nodes'],
): Promise<AuthorizedBlueprintSnapshot['nodes']> {
  const taskLabels = await labelsForSubjects(
    'task',
    orgId,
    nodes.filter((node) => node.kind === 'task').map((node) => node.id),
    tx,
  );
  return nodes.map((node) =>
    node.kind === 'task'
      ? {
          ...node,
          fields: {
            ...node.fields,
            labelIds: (taskLabels.get(node.id) ?? []).map((label) => LabelId.parse(label.id)),
          },
        }
      : node,
  );
}
async function discoverSnapshotRows(
  tx: TemplateTransaction,
  caller: ReturnType<typeof snapshotCaller>,
  reference: BlueprintWorkRef,
  options: BlueprintSnapshotOptions,
): Promise<BlueprintSnapshotRow[]> {
  const raw =
    options.scope === 'reference'
      ? [{ work: await readBlueprintWork(tx, caller.orgId, reference), parent: null }]
      : await discoverBlueprintRows(tx, caller.orgId, reference, {
          ...(caller.native && !caller.actor
            ? { include: nativeScheduleSnapshotFilter(caller.native) }
            : options.scope === 'retained' || (caller.retained && !caller.actor)
              ? { include: retainedSnapshotFilter(caller) }
              : {}),
          affected: options.scope === 'affected',
          ids: new Set([
            ...(options.ancestorIds ?? []),
            ...(options.seeds?.map((ref) => ref.id) ?? []),
          ]),
          anchors: new Set(options.dateAnchors ?? []),
        });
  const meta = await snapshotMetadata(tx, caller.orgId, raw);
  const mapped = await snapshotDateReferences(
    tx,
    caller.orgId,
    raw,
    mapBlueprintNodes(raw, meta.categories, meta.sourceTypes),
  );
  return selectBlueprintSnapshotRows(raw, mapped, options).rows;
}
/**
 * Capture a complete, bounded, authorized current tree on the caller's transaction.
 * @throws For hidden/foreign work, invalid retained authority, excessive size, or concurrent membership changes.
 */
export async function loadBlueprintSnapshot(
  tx: TemplateTransaction,
  authority: BlueprintSnapshotAuthority,
  reference: BlueprintWorkRef,
  options: BlueprintSnapshotOptions,
): Promise<AuthorizedBlueprintSnapshot> {
  const caller = snapshotCaller(tx, authority);
  const discover = () => discoverSnapshotRows(tx, caller, reference, options);
  let rows = await discover();
  await authorizeBlueprintRows(tx, caller, rows, false);
  if (options.forUpdate) rows = await lockSnapshot(tx, caller.orgId, rows, discover);
  const metadata = await snapshotMetadata(tx, caller.orgId, rows);
  let nodes: AuthorizedBlueprintSnapshot['nodes'] = await snapshotDateReferences(
    tx,
    caller.orgId,
    rows,
    mapBlueprintNodes(rows, metadata.categories, metadata.sourceTypes),
  );
  nodes = await withTaskLabels(tx, caller.orgId, nodes);
  if (options.access === 'edit') {
    const selection = selectBlueprintSnapshotRows(rows, nodes, options);
    await authorizeBlueprintRows(
      tx,
      caller,
      rows.filter(({ work }) => selection.writes.has(work.id)),
      true,
    );
  }
  const root = nodes[0];
  if (!root) throw new BlueprintError('blueprint_invalid', 'Missing tree root.');
  const context = await snapshotContext(tx, caller, rows, nodes, options.now ?? new Date());
  const taskIds = rows.flatMap(({ work }) => (work.kind === 'task' ? [work.id] : []));
  const edges = taskIds.length
    ? await tx
        .select()
        .from(taskDependency)
        .where(
          and(
            eq(taskDependency.organizationId, caller.orgId),
            or(
              inArray(taskDependency.blockingTaskId, taskIds),
              inArray(taskDependency.blockedTaskId, taskIds),
            ),
          ),
        )
        .limit(2001)
    : [];
  if (edges.length > 2000)
    throw new BlueprintError('blueprint_limit', 'Capture at most 2000 dependencies.');
  const dependencies = edges.map((edge) => ({
    blockerId: edge.blockingTaskId,
    blockedId: edge.blockedTaskId,
  }));
  const rowsByRef = new Map(rows.map(({ work }) => [`${work.kind}:${work.id}`, work]));
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({ rows, context: { ...context, creationDate: undefined }, dependencies }),
    )
    .digest('hex');
  return { root, nodes, rowsByRef, context, dependencies, fingerprint };
}
