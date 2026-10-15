import { BlueprintError, validateBlueprintGraph } from '@docket/work/blueprints';
import type {
  BlueprintPath,
  PublishedBlueprintSnapshot,
  ResolvedBlueprintGraph,
  WorkKind,
} from '@docket/work/blueprints';
import type { BlueprintStep } from '@docket/work/work-template-blueprint';
import { blueprintFingerprint } from './fingerprint';

/** The transaction adapter reads authorized publications; null selection means the kind's base. */
export type BlueprintPublicationReader = (
  kind: WorkKind,
  selection: BlueprintStep['template'],
  exactVersionId?: string,
) => Promise<PublishedBlueprintSnapshot>;

export { resolveRetainedBlueprintCatalog } from './catalog-retained';

/** Publication checks all optional branches; creation defers actual limits to the selected planner. */
export type BlueprintCatalogMode = 'publication' | 'creation';

interface CatalogState {
  readonly root: PublishedBlueprintSnapshot;
  readonly read: BlueprintPublicationReader;
  readonly cache: Map<string, PublishedBlueprintSnapshot>;
  readonly publications: Map<string, PublishedBlueprintSnapshot>;
  readonly resolutions: ResolvedBlueprintGraph['resolutions'][number][];
  readonly mode: BlueprintCatalogMode;
  count: number;
}

async function readPublication(
  state: CatalogState,
  kind: WorkKind,
  selection: BlueprintStep['template'],
): Promise<PublishedBlueprintSnapshot> {
  const key = JSON.stringify([kind, selection]);
  const cached = state.cache.get(key);
  if (cached) return cached;
  const publication = await state.read(kind, selection);
  if (
    publication.organizationId !== state.root.organizationId ||
    publication.kind !== kind ||
    (selection && publication.workTypeId !== selection.workTypeId) ||
    (selection?.selection.kind === 'pinned' &&
      publication.versionId !== selection.selection.workTypeVersionId)
  )
    throw new BlueprintError(
      'blueprint_invalid',
      'Resolved template does not match this workspace and selection.',
    );
  state.cache.set(key, publication);
  state.publications.set(`${publication.workTypeId}:${publication.versionId}`, publication);
  return publication;
}

async function visitScope(
  state: CatalogState,
  owner: PublishedBlueprintSnapshot,
  path: BlueprintPath,
  ancestors: readonly string[],
): Promise<void> {
  if (ancestors.includes(owner.workTypeId)) {
    throw new BlueprintError(
      'blueprint_loop',
      'A nested template references its own template identity.',
      [path],
    );
  }
  const stack = [...ancestors, owner.workTypeId];
  const steps = [...owner.definition.blueprint.steps].sort(
    (a, b) => a.sort - b.sort || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
  for (const step of steps) {
    if (++state.count > (state.mode === 'publication' ? 500 : 10000))
      throw new BlueprintError(
        'blueprint_limit',
        state.mode === 'publication'
          ? 'Blueprint limit is 500 work rows including the root and Milestones.'
          : 'Blueprint expansion exceeds the bounded preview limit.',
      );
    if (step.kind === 'milestone') continue;
    const publication = await readPublication(state, step.kind, step.template);
    const childPath = [...path, step.key];
    state.resolutions.push({
      path: childPath,
      workTypeId: publication.workTypeId,
      versionId: publication.versionId,
    });
    // Inline base identity supplies defaults only. Explicit template references own nested children.
    if (step.template) await visitScope(state, publication, childPath, stack);
  }
}

/**
 * Freeze exact child publications for one authorized transaction, qualifying repeated template instances.
 * @throws {BlueprintError} For invalid references, loops, or the selected mode's bounded expansion.
 */
export async function resolveBlueprintCatalog(
  root: PublishedBlueprintSnapshot,
  read: BlueprintPublicationReader,
  mode: BlueprintCatalogMode = 'creation',
): Promise<ResolvedBlueprintGraph> {
  const state: CatalogState = {
    root,
    read,
    cache: new Map(),
    publications: new Map(),
    resolutions: [],
    mode,
    count: 1,
  };
  await visitScope(state, root, [], []);
  const publications = [...state.publications.values()].sort((a, b) => {
    const left = `${a.workTypeId}:${a.versionId}`,
      right = `${b.workTypeId}:${b.versionId}`;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const facts = { root, publications, resolutions: state.resolutions };
  const graph: ResolvedBlueprintGraph = { ...facts, fingerprint: blueprintFingerprint(facts) };
  if (mode === 'publication') validateBlueprintGraph(graph);
  return graph;
}
