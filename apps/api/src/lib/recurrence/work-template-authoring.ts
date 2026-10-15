import {
  blueprintInvocation,
  blueprintConversion,
  blueprintStep,
  processDependency,
  processRevision,
  type BlueprintInvocationManifest,
  type BlueprintInvocationRoot,
  type BlueprintInvocationStep,
} from '@docket/db';
import { and, eq, sql } from 'drizzle-orm';
import { CapabilityError, ConflictError } from '../../error';
import type { TemplateTransaction } from '../templates/persistence';
import {
  createPublishedWorkTemplateInTransaction,
  type TemplateCreationEffect,
} from '../templates/service';
import { loadCreationActor } from '../work-creation/context';
import {
  loadRecurrenceBlueprintSources,
  type RecurrenceBlueprintSource,
} from './work-template-source';
import { recurrenceWorkTemplateDefinition } from './work-template-definition';

interface BindingCommand {
  readonly organizationId: string;
  readonly actorId: string | undefined;
  readonly revisionId: string;
  readonly name: string;
}
interface RootPublication {
  readonly root: BlueprintInvocationRoot;
  readonly projections: ReadonlyMap<string, string>;
}
async function publishRoot(
  tx: TemplateTransaction,
  command: BindingCommand,
  source: RecurrenceBlueprintSource,
  sources: readonly RecurrenceBlueprintSource[],
  effects: TemplateCreationEffect[],
): Promise<RootPublication> {
  const selectedId = source.preset.fields['work_type_id'];
  const selectedVersion = source.preset.fields['work_type_version_id'];
  const base = {
    sourceStepId: source.id,
    sourceKey: source.sourceKey,
    key: source.key,
    kind: source.kind === 'project' ? ('project' as const) : ('task' as const),
  };
  if (typeof selectedId === 'string' && typeof selectedVersion === 'string')
    return {
      root: { ...base, workTypeId: selectedId, workTypeVersionId: selectedVersion },
      projections: new Map(),
    };
  if (!command.actorId) throw new CapabilityError();
  const caller = await loadCreationActor(tx, command.organizationId, command.actorId);
  const definition = recurrenceWorkTemplateDefinition(command.name, source, sources);
  const created = await createPublishedWorkTemplateInTransaction(tx, caller, {
    targetType: base.kind,
    scope: 'organization',
    offeredTeamIds: [],
    definition,
  });
  effects.push(...created.effects);
  const versionId = created.row.latestPublishedVersionId;
  if (!versionId) throw new ConflictError('Process publication was not created');
  const rows = await tx
    .select()
    .from(blueprintStep)
    .where(
      and(
        eq(blueprintStep.organizationId, command.organizationId),
        eq(blueprintStep.versionId, versionId),
      ),
    );
  return {
    root: { ...base, workTypeId: created.row.id, workTypeVersionId: versionId },
    projections: new Map(rows.map((row) => [row.key, row.id])),
  };
}
/** Persist the compatibility process's canonical selection and private invocation in its existing authoring transaction. */
export async function bindPublishedProcessBlueprint(
  tx: TemplateTransaction,
  command: BindingCommand,
): Promise<readonly TemplateCreationEffect[]> {
  if (!command.actorId) throw new CapabilityError();
  await loadCreationActor(tx, command.organizationId, command.actorId);
  const sources = await loadRecurrenceBlueprintSources(
    tx,
    command.organizationId,
    command.revisionId,
  );
  const effects: TemplateCreationEffect[] = [];
  const publications = new Map<string, RootPublication>();
  for (const root of sources.filter((source) => source.id === source.rootId))
    publications.set(root.id, await publishRoot(tx, command, root, sources, effects));
  const steps: BlueprintInvocationStep[] = sources.map((source) => {
    const publication = publications.get(source.rootId);
    if (!publication) throw new ConflictError('Process root is missing');
    return {
      sourceStepId: source.id,
      sourceKey: source.sourceKey,
      rootKey: publication.root.key,
      path: source.id === source.rootId ? [] : [source.key],
      blueprintStepId: publication.projections.get(source.key) ?? null,
      sourceVersionId: source.id === source.rootId ? null : publication.root.workTypeVersionId,
    };
  });
  const dependencies = await tx
    .select()
    .from(processDependency)
    .where(
      and(
        eq(processDependency.organizationId, command.organizationId),
        eq(processDependency.revisionId, command.revisionId),
      ),
    );
  const manifest: BlueprintInvocationManifest = {
    kind: 'published',
    legacyProcessRevisionId: command.revisionId,
    roots: [...publications.values()].map((value) => value.root),
    steps,
    dependencies: dependencies.map((edge) => ({
      blockerStepId: edge.blockingStepId,
      blockedStepId: edge.blockedStepId,
    })),
  };
  const [invocation] = await tx
    .insert(blueprintInvocation)
    .values({
      organizationId: command.organizationId,
      ownerActorId: command.actorId,
      manifest,
      overrides: sources.map((source) => source.preset),
    })
    .returning();
  if (!invocation) throw new ConflictError('Process binding was not created');
  const [source] = await tx
    .select({
      fingerprint: sql<string>`docket_blueprint_source_fingerprint(${command.revisionId})`,
    })
    .from(processRevision)
    .where(
      and(
        eq(processRevision.id, command.revisionId),
        eq(processRevision.organizationId, command.organizationId),
      ),
    )
    .limit(1);
  if (!source) throw new ConflictError('Process source fingerprint is missing');
  await tx.insert(blueprintConversion).values({
    organizationId: command.organizationId,
    legacyProcessRevisionId: command.revisionId,
    invocationId: invocation.id,
    sourceFingerprint: source.fingerprint,
  });
  return effects;
}
