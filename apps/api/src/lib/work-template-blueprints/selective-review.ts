import {
  BlueprintError,
  diffBlueprint,
  expandBlueprint,
  planBlueprint,
  type BlueprintDifference,
  type BlueprintDiffInput,
  type ExistingBlueprintNode,
  type PlannedWorkTree,
} from '@docket/work/blueprints';
import type { TemplateTargetType } from '@docket/work/template-contract';
import {
  WorkTemplateChangePreview,
  type WorkTemplateChangeRequest,
} from '@docket/work/work-template-reference';
import type { ActorCtx } from '../../context';
import { ConflictError } from '../../error';
import type { TemplateTransaction } from '../templates/persistence';
import {
  prepareTemplateChange,
  type PreparedTemplateChange,
} from '../work-template-change-preview';
import { requireWorkAccess, selectedVersion } from '../work-template-selection';
import { readBlueprintWork } from './snapshot-rows';
import { loadBlueprintSnapshot } from './snapshot';
import type { AuthorizedBlueprintSnapshot } from './snapshot-types';
import {
  readBlueprintClosure,
  lockBlueprintClosures,
  type ResolvedBlueprintClosure,
} from './resolve';
import { blueprintFingerprint } from './fingerprint';
import { selectiveCurrentNodes, selectiveRootDraft } from './selective-snapshot';
import { selectiveChangeSummaries } from './selective-summary';
import { selectivePermissionFacts } from './selective-permissions';
import { resolveBlueprintLabelDefaults } from './labels';
import {
  currentSelectiveChoices,
  acceptedSelectiveChoices,
  selectedSelectivePaths,
} from './selective-options';
import { loadManagedBlueprintDependencies } from './managed-dependencies';

/** Server-only complete reviewed facts; no prepared insert values escape the API response. */
export interface PreparedSelectiveReview {
  readonly caller: ActorCtx;
  readonly kind: TemplateTargetType;
  readonly snapshot: AuthorizedBlueprintSnapshot;
  readonly current: readonly ExistingBlueprintNode[];
  readonly graph: ResolvedBlueprintClosure;
  readonly tree: PlannedWorkTree;
  readonly differences: readonly BlueprintDifference[];
  readonly starting: PreparedTemplateChange | null;
  readonly preview: WorkTemplateChangePreview;
}

function dependencyInput(
  snapshot: AuthorizedBlueprintSnapshot,
  nodes: readonly ExistingBlueprintNode[],
  owned: readonly { blockerId: string; blockedId: string }[],
): BlueprintDiffInput['currentDependencies'] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return snapshot.dependencies.flatMap((edge) => {
    const blocker = byId.get(edge.blockerId),
      blocked = byId.get(edge.blockedId);
    return blocker && blocked
      ? [
          {
            blockerPath: blocker.path,
            blockedPath: blocked.path,
            serviceOwned: owned.some(
              (managed) =>
                managed.blockerId === edge.blockerId && managed.blockedId === edge.blockedId,
            ),
          },
        ]
      : [];
  });
}

async function loadReviewSelection(
  tx: TemplateTransaction,
  caller: ActorCtx,
  input: { kind: TemplateTargetType; id: string; selection: WorkTemplateChangeRequest },
) {
  const { kind, id, selection } = input;
  const before = await readBlueprintWork(tx, caller.orgId, { kind, id });
  await requireWorkAccess(tx, caller, kind, id);
  if (before.kind === 'milestone')
    throw new BlueprintError('blueprint_invalid', 'A checkpoint cannot change template.');
  if ((selection.mode ?? 'change') === 'update' && before.row.workTypeId !== selection.workTypeId)
    throw new ConflictError('Update the current template.', 'blueprint_preview_stale');
  const graph = await readBlueprintClosure(tx, {
    organizationId: caller.orgId,
    kind,
    ...selection,
  });
  await lockBlueprintClosures(tx, [graph]);
  const snapshot = await loadBlueprintSnapshot(
    tx,
    caller,
    { kind, id },
    { scope: 'tree', forUpdate: true },
  );
  const current = selectiveCurrentNodes(snapshot);
  const root = selectiveRootDraft(snapshot);
  const publication = await selectedVersion(tx, caller.orgId, kind, selection, root.teamId);
  const mode = selection.mode ?? 'change';
  if (mode === 'update' && root.terminal)
    throw new BlueprintError('blueprint_invalid', 'Terminal work cannot update its template.');
  const work = snapshot.rowsByRef.get(`${kind}:${id}`);
  if (!work || work.kind === 'milestone')
    throw new BlueprintError('blueprint_invalid', 'Missing root.');
  const starting =
    mode === 'change' && !root.terminal
      ? await prepareTemplateChange(tx, kind, work.row, {
          teamId: root.teamId,
          selection,
          publication,
        })
      : null;
  return { graph, snapshot, current, root, mode, starting, work, publication };
}

/** Resolve and lock one whole authorized tree and exact publication closure before reviewing changes. */
export async function prepareSelectiveReview(
  tx: TemplateTransaction,
  caller: ActorCtx,
  kind: TemplateTargetType,
  id: string,
  selection: WorkTemplateChangeRequest,
): Promise<PreparedSelectiveReview> {
  const { graph, snapshot, current, root, mode, starting, work, publication } =
    await loadReviewSelection(tx, caller, { kind, id, selection });
  const context = {
    ...snapshot.context,
    completions: snapshot.context.completions.map((completion) => ({
      ...completion,
      path: current.find((node) => node.id === completion.id)?.path ?? completion.path,
    })),
  };
  const selected = {
    graph,
    root,
    context,
    choices: currentSelectiveChoices(graph, work.row.blueprintState?.optionalChoices ?? []),
  };
  const differences = diffBlueprint({
    mode,
    current,
    currentDependencies: dependencyInput(
      snapshot,
      current,
      await loadManagedBlueprintDependencies(tx, snapshot),
    ),
    selected,
  });
  const choices = expandBlueprint(graph, [])
    .nodes.filter((node) => node.step?.optional.enabled)
    .map((node) => ({ path: [...node.path], selected: true }));
  const tree = await resolveBlueprintLabelDefaults(
    tx,
    caller.orgId,
    planBlueprint({ ...selected, choices }),
  );
  const childChanges = selectiveChangeSummaries(differences, current, tree.nodes, (change) =>
    selectedSelectivePaths(
      graph,
      acceptedSelectiveChoices(graph, selected.choices, differences, new Set([change.changeId])),
    ),
  );
  const preview = WorkTemplateChangePreview.parse({
    warnings: tree.warnings,
    versionNumber: publication.versionNumber,
    workTypeId: graph.root.workTypeId,
    workTypeVersionId: graph.root.versionId,
    mode,
    changes: starting?.preview.changes ?? [],
    childChanges,
    previewToken: blueprintFingerprint({
      actorId: caller.actorId,
      kind,
      snapshot: snapshot.fingerprint,
      current,
      graph: graph.fingerprint,
      fields: starting?.preview,
      tree,
      differences,
      permissions: await selectivePermissionFacts(tx, caller, snapshot),
    }),
  });
  return { caller, kind, snapshot, current, graph, tree, differences, starting, preview };
}
