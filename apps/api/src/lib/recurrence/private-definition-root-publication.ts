import { WorkTypeId, WorkTypeVersionId } from '@docket/work/ids';
import type { ActorCtx } from '../../context';
import { ConflictError } from '../../error';
import type { TemplateTransaction } from '../templates/persistence';
import {
  createPublishedWorkTemplateInTransaction,
  type TemplateCreationEffect,
} from '../templates/service';
import { selectedVersion } from '../work-template-selection';
import { readBlueprintClosure, lockBlueprintClosures } from '../work-template-blueprints/resolve';
import { recurrenceWorkTemplateDefinition } from './work-template-definition';
import type { RecurrenceBlueprintSource } from './work-template-source';
import type { PrivateDefinitionRootPublication } from './private-definition-compiler';
/** Exact current root publications and post-commit effects from the single existing publication service. */
export interface PublishedPrivateRoots {
  readonly publications: ReadonlyMap<string, PrivateDefinitionRootPublication>;
  readonly effects: readonly TemplateCreationEffect[];
}
async function singleTaskBase(
  tx: TemplateTransaction,
  caller: ActorCtx,
  sources: readonly RecurrenceBlueprintSource[],
) {
  const only = sources.length === 1 ? sources[0] : undefined;
  if (only?.kind !== 'task' || typeof only.preset.fields['work_type_id'] === 'string') return null;
  const base = await readBlueprintClosure(tx, { organizationId: caller.orgId, kind: 'task' });
  await lockBlueprintClosures(tx, [base]);
  return {
    id: only.id,
    publication: { workTypeId: base.root.workTypeId, workTypeVersionId: base.root.versionId },
  };
}
/** Resolve actual pinned selected roots and publish only sanitized reusable structure for inline authored roots. */
export async function publishPrivateDefinitionRoots(
  tx: TemplateTransaction,
  caller: ActorCtx,
  name: string,
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
  await lockBlueprintClosures(tx, graphs);
  const publications = new Map<string, PrivateDefinitionRootPublication>(),
    effects: TemplateCreationEffect[] = [];
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
  const base = await singleTaskBase(tx, caller, sources);
  if (base) publications.set(base.id, base.publication);
  for (const root of roots) {
    if (publications.has(root.id)) continue;
    if (root.kind === 'milestone')
      throw new ConflictError('Private root publication is unavailable.');
    const created = await createPublishedWorkTemplateInTransaction(tx, caller, {
      targetType: root.kind,
      scope: 'organization',
      offeredTeamIds: [],
      definition: recurrenceWorkTemplateDefinition(name, root, sources),
    });
    const version = created.row.latestPublishedVersionId;
    if (!version) throw new ConflictError('Private root publication is unavailable.');
    publications.set(root.id, { workTypeId: created.row.id, workTypeVersionId: version });
    effects.push(...created.effects);
  }
  return { publications, effects };
}
