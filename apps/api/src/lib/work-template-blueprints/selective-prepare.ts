import { genId } from '@docket/db';
import {
  BlueprintError,
  matchedBlueprintRow,
  type BlueprintMatchIndex,
} from '@docket/work/blueprints';
import type { WorkTemplateChangeField } from '@docket/work/work-template-reference';
import type { TemplateTransaction } from '../templates/persistence';
import { prepareBlueprintEntries } from './preflight-entries';
import { prepareGenerationMetadata } from './generation';
import { allocateBlueprintPlacement } from './placement';
import type { PreparedBlueprintCreation } from './preflight';
import type { RetainedBlueprintEntry } from './retained';
import type { PreparedSelectiveReview } from './selective-review';
import { selectivePlacement } from './selective-snapshot';
import { selectivePreparationCommand } from './selective-command';
import { acceptedSelectiveChoices, selectedSelectivePaths } from './selective-options';

function matchSelectiveNodes(review: PreparedSelectiveReview, additions: ReadonlySet<string>) {
  const index: BlueprintMatchIndex = {
    current: review.current,
    planned: review.tree.nodes,
    matches: new Map(),
  };
  const existing = new Map<string, RetainedBlueprintEntry>();
  const ids = new Map<string, string>();
  const rootWork = review.snapshot.rowsByRef.get(`${review.kind}:${review.snapshot.root.id}`);
  if (!rootWork) throw new BlueprintError('blueprint_invalid', 'Missing reviewed root.');
  const visibility = 'visibility' in rootWork.row ? rootWork.row.visibility : 'public';
  const nodes = review.tree.nodes.filter((node) => {
    const key = JSON.stringify(node.path);
    const matched =
      node.parentPath === null ? review.snapshot.root : matchedBlueprintRow(index, node);
    if (!matched) {
      if (additions.has(key)) {
        ids.set(key, genId());
        return true;
      }
      return false;
    }
    const work = review.snapshot.rowsByRef.get(`${matched.kind}:${matched.id}`);
    if (!work) throw new BlueprintError('blueprint_invalid', 'Missing reviewed match.');
    ids.set(key, work.id);
    existing.set(key, {
      work,
      snapshot: matched,
      actualPlacement: selectivePlacement(work),
      visibility: 'visibility' in work.row ? work.row.visibility : visibility,
    });
    return true;
  });
  return { existing, ids, rootWork, visibility, nodes };
}

/** Fully preflight accepted additions against exact current physical matches without inserting a new root. */
export async function prepareSelectiveTree(
  tx: TemplateTransaction,
  review: PreparedSelectiveReview,
  accepted: ReadonlySet<string>,
  startingFields: readonly WorkTemplateChangeField[] = [],
): Promise<PreparedBlueprintCreation> {
  const rootState = review.snapshot.rowsByRef.get(`${review.kind}:${review.snapshot.root.id}`)?.row
    .blueprintState;
  const optionalChoices = acceptedSelectiveChoices(
    review.graph,
    rootState?.optionalChoices ?? [],
    review.differences,
    accepted,
  );
  const selected = selectedSelectivePaths(review.graph, optionalChoices);
  const additions = new Set(
    review.differences.flatMap((change) =>
      change.kind === 'add_child' && accepted.has(change.changeId)
        ? change.nodes
            .filter((node) => selected.has(JSON.stringify(node.path)))
            .map((node) => JSON.stringify(node.path))
        : [],
    ),
  );
  const { existing, ids, rootWork, visibility, nodes } = matchSelectiveNodes(review, additions);
  const actual = new Map(
    [...existing].map(([path, entry]) => [
      path,
      { placement: entry.actualPlacement, visibility: entry.visibility },
    ]),
  );
  const effectiveVisibility =
    startingFields.includes('visibility') && review.starting?.values['visibility'] === 'private'
      ? 'private'
      : visibility;
  const allocated = allocateBlueprintPlacement(nodes, ids, actual);
  const command = { ...selectivePreparationCommand(review), blueprint: { optionalChoices } };
  const entries = await prepareBlueprintEntries(tx, {
    selected: command,
    root: null,
    allocated,
    visibility: effectiveVisibility,
    preparationContext: undefined,
    existing,
  });
  const tree = {
    ...review.tree,
    nodes,
    dependencies: [],
    manifest: review.tree.manifest.filter((entry) => ids.has(JSON.stringify(entry.path))),
  };
  const context = { ...review.snapshot.context, existingNodes: review.current };
  await prepareGenerationMetadata(tx, entries, {
    tree,
    context,
    options: { optionalChoices: [] },
    generationKey: rootWork.id,
  });
  return {
    command,
    graph: review.graph,
    context,
    tree,
    previewToken: review.preview.previewToken,
    entries,
    rowCount: entries.filter((entry) => entry.kind !== 'existing').length,
  };
}
