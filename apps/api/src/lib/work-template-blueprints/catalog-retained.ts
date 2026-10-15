import {
  BlueprintError,
  type PublishedBlueprintSnapshot,
  type ResolvedBlueprintGraph,
  type WorkKind,
} from '@docket/work/blueprints';
import type { BlueprintStep, ResolvedVersionAtPath } from '@docket/work/work-template-blueprint';
import { resolveBlueprintCatalog, type BlueprintPublicationReader } from './catalog';

interface RetainedCatalog {
  readonly root: PublishedBlueprintSnapshot;
  readonly read: BlueprintPublicationReader;
  readonly manifest: ReadonlyMap<string, ResolvedVersionAtPath>;
  readonly visited: Set<string>;
  readonly cache: Map<string, PublishedBlueprintSnapshot>;
  readonly preferred: Map<string, ResolvedVersionAtPath>;
}
function invalid(): never {
  throw new BlueprintError('blueprint_invalid', 'The accepted publication manifest changed.');
}
function preferenceKey(kind: WorkKind, selection: BlueprintStep['template']): string {
  return JSON.stringify([kind, selection?.workTypeId ?? null]);
}
function validateRead(
  state: RetainedCatalog,
  publication: PublishedBlueprintSnapshot,
  expected: {
    readonly kind: WorkKind;
    readonly typeId: string | undefined;
    readonly versionId: string | undefined;
  },
): void {
  if (
    publication.organizationId !== state.root.organizationId ||
    publication.kind !== expected.kind ||
    (expected.typeId && publication.workTypeId !== expected.typeId) ||
    (expected.versionId && publication.versionId !== expected.versionId)
  )
    invalid();
}
async function readCached(
  state: RetainedCatalog,
  kind: WorkKind,
  selection: BlueprintStep['template'],
  exactVersionId?: string,
): Promise<PublishedBlueprintSnapshot> {
  const version =
    selection?.selection.kind === 'pinned' ? selection.selection.workTypeVersionId : exactVersionId;
  const key = JSON.stringify([kind, selection?.workTypeId ?? null, version ?? null]);
  const cached = state.cache.get(key);
  if (cached) return cached;
  const publication = await state.read(kind, selection, version);
  validateRead(state, publication, { kind, typeId: selection?.workTypeId, versionId: version });
  state.cache.set(key, publication);
  return publication;
}
function rememberPreference(
  state: RetainedCatalog,
  step: BlueprintStep,
  accepted: ResolvedVersionAtPath,
): void {
  if (step.kind === 'milestone') invalid();
  if (step.template?.selection.kind === 'pinned') {
    if (step.template.selection.workTypeVersionId !== accepted.versionId) invalid();
    return;
  }
  const key = preferenceKey(step.kind, step.template);
  const previous = state.preferred.get(key);
  if (
    previous &&
    (previous.workTypeId !== accepted.workTypeId || previous.versionId !== accepted.versionId)
  )
    invalid();
  state.preferred.set(key, accepted);
}
async function inspectOwner(
  state: RetainedCatalog,
  owner: PublishedBlueprintSnapshot,
  path: readonly string[],
  ancestors: readonly string[],
): Promise<void> {
  if (ancestors.includes(owner.workTypeId)) invalid();
  for (const step of owner.definition.blueprint.steps) {
    if (step.kind === 'milestone') continue;
    const childPath = [...path, step.key];
    const key = JSON.stringify(childPath);
    const accepted = state.manifest.get(key);
    if (!accepted) continue;
    if (step.template && step.template.workTypeId !== accepted.workTypeId) invalid();
    rememberPreference(state, step, accepted);
    const publication = await readCached(state, step.kind, step.template, accepted.versionId);
    if (publication.workTypeId !== accepted.workTypeId) invalid();
    state.visited.add(key);
    if (step.template)
      await inspectOwner(state, publication, childPath, [...ancestors, owner.workTypeId]);
  }
}

/**
 * Retain selected accepted latest versions once per type while honoring each immutable explicit pin.
 * Preclassification handles an unselected occurrence visited before an accepted occurrence.
 * This pure function grants no authority; database adapters must supply a checked persisted manifest.
 * @throws For inconsistent root/path/type/version facts or a changed accepted latest selection.
 */
export async function resolveRetainedBlueprintCatalog(
  root: PublishedBlueprintSnapshot,
  manifest: readonly ResolvedVersionAtPath[],
  read: BlueprintPublicationReader,
): Promise<ResolvedBlueprintGraph> {
  const byPath = new Map(manifest.map((entry) => [JSON.stringify(entry.path), entry]));
  const acceptedRoot = byPath.get('[]');
  if (
    manifest.length > 500 ||
    byPath.size !== manifest.length ||
    acceptedRoot?.workTypeId !== root.workTypeId ||
    acceptedRoot.versionId !== root.versionId
  )
    invalid();
  const state: RetainedCatalog = {
    root,
    read,
    manifest: byPath,
    visited: new Set(['[]']),
    preferred: new Map(),
    cache: new Map(),
  };
  await inspectOwner(state, root, [], []);
  if (state.visited.size !== byPath.size) invalid();
  return resolveBlueprintCatalog(root, async (kind, selection) => {
    const preferred =
      selection?.selection.kind === 'pinned'
        ? undefined
        : state.preferred.get(preferenceKey(kind, selection));
    return readCached(state, kind, selection, preferred?.versionId);
  });
}
