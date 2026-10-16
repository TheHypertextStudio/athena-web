import { BlueprintStepId } from '../src/ids';
import type { GalleryEntry } from '../src/gallery/types';
import { GALLERY_CATALOG } from '../src/gallery/catalog';
import type {
  PublishedBlueprintSnapshot,
  ResolvedBlueprintGraph,
  ResolvedRootDraft,
} from '../src/blueprints/types';
import { publication, ulid, context, actor, team } from './blueprint-fixtures';

/** Supply static exact publication facts to the shared engine; this test helper does no planning or persistence. */
export function galleryGraph(entry: GalleryEntry): ResolvedBlueprintGraph {
  const bases = ['task', 'project', 'program', 'initiative'].map((kind, i) =>
    publication(8000 + i, kind as PublishedBlueprintSnapshot['kind']),
  );
  const sources = GALLERY_CATALOG.map((value, i) => ({
    ...bases[0],
    organizationId: context().organizationId,
    kind: value.definition.payload.targetType,
    workTypeId: value.id,
    versionId: value.versionId,
    definition: value.definition,
    stepIds: Object.fromEntries(
      value.definition.blueprint.steps.map((step, n) => [
        step.key,
        BlueprintStepId.parse(ulid(100000 + i * 500 + n)),
      ]),
    ),
  }));
  const root = sources.find((source) => source.workTypeId === entry.id);
  if (!root) throw new Error('Missing catalog root');
  const used = new Map<string, PublishedBlueprintSnapshot>();
  const resolutions: ResolvedBlueprintGraph['resolutions'][number][] = [];
  function visit(
    source: PublishedBlueprintSnapshot,
    path: string[],
    ancestors: ReadonlySet<string>,
  ): void {
    if (ancestors.has(source.versionId)) throw new Error('Static catalog source loop');
    for (const step of source.definition.blueprint.steps) {
      if (step.kind === 'milestone') continue;
      const chosen = step.template
        ? sources.find((value) => value.workTypeId === step.template?.workTypeId)
        : bases.find((value) => value.kind === step.kind);
      if (!chosen) throw new Error('Missing catalog reference');
      const childPath = [...path, step.key];
      used.set(chosen.versionId, chosen);
      resolutions.push({
        path: childPath,
        workTypeId: chosen.workTypeId,
        versionId: chosen.versionId,
      });
      if (step.template) visit(chosen, childPath, new Set([...ancestors, source.versionId]));
    }
  }
  visit(root, [], new Set());
  return {
    root,
    publications: [...used.values()],
    resolutions,
    fingerprint: 'checked-static-catalog',
  };
}
/** Supply an actual root draft and common authorized context for deterministic catalog expansion. */
export function galleryInput(entry: GalleryEntry, anchor = '2026-12-31') {
  const common = { teamId: team, responsibleActorId: actor, cycleId: null, dates: {} };
  let root: ResolvedRootDraft;
  switch (entry.definition.payload.targetType) {
    case 'task':
      root = {
        ...common,
        kind: 'task',
        fields: { title: entry.definition.name },
        dates: { dueDate: anchor },
      };
      break;
    case 'project':
      root = {
        ...common,
        kind: 'project',
        fields: { name: entry.definition.name },
        dates: { targetDate: anchor },
      };
      break;
    case 'initiative':
      root = {
        ...common,
        kind: 'initiative',
        fields: { name: entry.definition.name },
        dates: { targetDate: anchor },
      };
      break;
    case 'program':
      root = { ...common, kind: 'program', fields: { name: entry.definition.name } };
  }
  return { graph: galleryGraph(entry), root, context: context(), choices: [] };
}
