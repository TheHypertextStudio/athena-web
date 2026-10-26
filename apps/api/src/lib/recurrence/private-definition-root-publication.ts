import { WorkTypeId, WorkTypeVersionId } from '@docket/work/ids';
import type { ActorCtx } from '../../context';
import { ConflictError } from '../../error';
import type { TemplateTransaction } from '../templates/persistence';
import { selectedVersion } from '../work-template-selection';
import { readBlueprintClosure, lockBlueprintClosures } from '../work-template-blueprints/resolve';
import type { RecurrenceBlueprintSource } from './work-template-source';
import type { PrivateDefinitionRootPublication } from './private-definition-compiler';
/** Exact current root publications: selected pins, or the workspace base for inline authored roots. */
export interface PublishedPrivateRoots {
  readonly publications: ReadonlyMap<string, PrivateDefinitionRootPublication>;
}
/**
 * Resolve actual pinned selected roots and the workspace base publication for inline authored roots.
 * Authored structure stays with the private invocation; no template or version is created.
 */
export async function publishPrivateDefinitionRoots(
  tx: TemplateTransaction,
  caller: ActorCtx,
  sources: readonly RecurrenceBlueprintSource[],
): Promise<PublishedPrivateRoots> {
  const roots = sources.filter((source) => source.id === source.rootId);
  if (roots.some((root) => root.kind === 'milestone'))
    throw new ConflictError('Private root publication is unavailable.');
  const selections = roots
    .flatMap((source) => {
      const id = source.preset.fields['work_type_id'],
        version = source.preset.fields['work_type_version_id'];
      return typeof id === 'string' && typeof version === 'string' ? [{ source, id, version }] : [];
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  const inlineKinds = [
    ...new Set(
      roots
        .filter((root) => !selections.some((selection) => selection.source.id === root.id))
        .map((root) => (root.kind === 'project' ? 'project' : 'task')),
    ),
  ].sort();
  const bases = await Promise.all(
    inlineKinds.map((kind) => readBlueprintClosure(tx, { organizationId: caller.orgId, kind })),
  );
  const graphs = await Promise.all(
    selections.map(({ source, id, version }) =>
      readBlueprintClosure(tx, {
        organizationId: caller.orgId,
        kind: source.kind === 'project' ? 'project' : 'task',
        workTypeId: id,
        workTypeVersionId: version,
      }),
    ),
  );
  await lockBlueprintClosures(tx, [...bases, ...graphs]);
  const publications = new Map<string, PrivateDefinitionRootPublication>();
  for (const { source, id, version } of selections) {
    const teamId = source.preset.fields['team_id'];
    const checked = await selectedVersion(
      tx,
      caller.orgId,
      source.kind === 'project' ? 'project' : 'task',
      { workTypeId: WorkTypeId.parse(id), workTypeVersionId: WorkTypeVersionId.parse(version) },
      typeof teamId === 'string' ? teamId : null,
    );
    publications.set(source.id, { workTypeId: id, workTypeVersionId: checked.id });
  }
  for (const root of roots) {
    if (publications.has(root.id)) continue;
    const base = bases.find((graph) => graph.root.kind === root.kind);
    if (!base) throw new ConflictError('Private root publication is unavailable.');
    publications.set(root.id, {
      workTypeId: base.root.workTypeId,
      workTypeVersionId: base.root.versionId,
    });
  }
  return { publications };
}
