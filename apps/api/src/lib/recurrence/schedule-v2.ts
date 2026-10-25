import type { WorkScheduleForestV2 } from '@docket/work/work-schedule-forest-v2';
import { orderPrivateScheduleRoots } from '@docket/work/work-schedule-forest-v2';
import { renderLegacyScheduleTitle } from '@docket/work/schedule-legacy-title';
import type { BlueprintNodeOverride, PlannedWorkTree } from '@docket/work/blueprints';
import { ConflictError } from '../../error';
import type { ScheduleDocument } from './schedule-compiler';

/** Select only a bound v2 legacy policy; pure conversion candidates cannot enter this path. */
export function legacyScheduleDocument(document: ScheduleDocument): WorkScheduleForestV2 | null {
  return document.kind === 'forest' &&
    document.revision === 2 &&
    document.titlePolicy.kind === 'legacy_title'
    ? document
    : null;
}

/** Server-only authored compatibility title, scoped to this accepted root's selected publication paths. */
export interface PrivateScheduleTitle {
  readonly path: readonly string[];
  readonly kind: 'task' | 'project' | 'milestone';
  readonly pattern: string;
}
function renderPrivateTitle(pattern: string, runDate: string): string {
  try {
    return renderLegacyScheduleTitle(pattern, runDate);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    throw new ConflictError('Use a nonblank private work title within the supported title limit.');
  }
}
/** Read exact authored compatibility titles without interpreting a source alias as a physical work identity. */
export function legacyScheduleTitles(
  document: WorkScheduleForestV2,
  rootKey: string,
): readonly PrivateScheduleTitle[] {
  if (document.titlePolicy.kind !== 'legacy_title') return [];
  return document.titles
    .filter((entry) => entry.target.rootKey === rootKey)
    .map((entry) => ({ path: entry.target.path, kind: entry.kind, pattern: entry.pattern }));
}
/** Render an exact compatibility root title; missing or changed authored root selection fails closed. */
export function legacyScheduleRootTitle(
  document: WorkScheduleForestV2,
  rootKey: string,
  kind: 'task' | 'project',
  runDate: string,
): string {
  const title = legacyScheduleTitles(document, rootKey).find((entry) => !entry.path.length);
  if (title?.kind !== kind) throw new ConflictError('The private authored root title changed.');
  return renderPrivateTitle(title.pattern, runDate);
}
/** Apply authored titles after ordinary document preparation, including authored Milestones and nested Tasks. */
export function legacyScheduleNodeTitles(
  tree: PlannedWorkTree,
  titles: readonly PrivateScheduleTitle[],
  runDate: string,
  overrides: readonly BlueprintNodeOverride[],
): BlueprintNodeOverride[] {
  const result = new Map(overrides.map((entry) => [JSON.stringify(entry.path), entry]));
  for (const title of titles) {
    if (!title.path.length) continue;
    const key = JSON.stringify(title.path);
    const node = tree.nodes.find((entry) => JSON.stringify(entry.path) === key);
    if (node?.kind !== title.kind)
      throw new ConflictError('The private authored title path changed.');
    const previous = result.get(key);
    result.set(key, {
      ...previous,
      path: title.path,
      fields: {
        ...node.fields,
        ...previous?.fields,
        [title.kind === 'task' ? 'title' : 'name']: renderPrivateTitle(title.pattern, runDate),
      },
      documentPrepared: true,
    });
  }
  return [...result.values()];
}

/** Check private lifecycle declarations against the actually selected immutable publication paths. */
export function validateScheduleV2Completion(
  document: ScheduleDocument,
  trees: readonly PlannedWorkTree[],
): void {
  if (
    document.kind !== 'forest' ||
    document.revision !== 2 ||
    document.completionPolicy.kind !== 'legacy_authored_tasks'
  )
    return;
  for (const reference of document.completionPolicy.tasks) {
    const index = orderPrivateScheduleRoots(document.roots, document.placements).findIndex(
      (root) => root.key === reference.rootKey,
    );
    const node = trees[index]?.nodes.find(
      (entry) => JSON.stringify(entry.path) === JSON.stringify(reference.path),
    );
    if (node?.kind !== 'task')
      throw new ConflictError('The private authored Task selection changed.');
  }
}
