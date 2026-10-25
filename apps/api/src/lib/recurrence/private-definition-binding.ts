import { blueprintInvocation, hashScheduleArchive, invocationRevision, template } from '@docket/db';
import { CanonicalPrivateWorkDefinition } from '@docket/work/work-private-definition';
import { WorkScheduleForestV2 } from '@docket/work/work-schedule-forest-v2';
import { ScheduleTimezone } from '@docket/work/work-schedule';
import { and, eq, sql } from 'drizzle-orm';
import { ProcessDefinitionCreate } from '../../contracts/recurrence';
import type { ActorCtx } from '../../context';
import { CapabilityError, ConflictError, NotFoundError } from '../../error';
import type { TemplateTransaction } from '../templates/persistence';
import { readBlueprintClosure, lockBlueprintClosures } from '../work-template-blueprints/resolve';
import { blueprintFingerprint } from '../work-template-blueprints/fingerprint';
import { rawResultRows } from '../raw-result';
import { canonicalDefinitionHead } from './canonical-definition';
import {
  requireLegacyDefinitionAccess,
  type LegacyDefinitionAccessRequest,
} from './legacy-definition-access';
import {
  compileAuthoredPrivateDefinition,
  type PrivateDefinitionRootPublication,
} from './private-definition-compiler';
import { compilePrivateDefinitionSources } from './private-definition-source';
import { recurrenceWorkTemplateDefinition } from './work-template-definition';
import type { RecurrenceBlueprintSource } from './work-template-source';

/** Opaque same-transaction private publication read capability; copied JSON has no authority. */
export interface CanonicalPrivatePublicationBinding {
  readonly proof: object;
}
/** Detached checked publication description; serializing or editing it creates no capability. */
export interface CheckedCanonicalPrivatePublication {
  readonly definitionId: string;
  readonly revisionId: string;
  readonly invocationId: string;
  readonly document: CanonicalPrivateWorkDefinition;
}
interface RegisteredPublication extends CheckedCanonicalPrivatePublication {
  readonly tx: TemplateTransaction;
  readonly organizationId: string;
  readonly actorId: string;
}
const bindings = new WeakMap<CanonicalPrivatePublicationBinding, RegisteredPublication>();
async function requireNamespace(tx: TemplateTransaction): Promise<void> {
  const [state] = rawResultRows<{ ready: boolean }>(
    await tx.execute(sql`select docket_private_identity_namespace_ready() as ready`),
  );
  if (!state?.ready)
    throw new ConflictError('Private definition identity registration is not ready.');
}
async function requireHeadOrigin(
  tx: TemplateTransaction,
  headId: string,
  organizationId: string,
): Promise<void> {
  const [row] = rawResultRows<{ origin: string | null }>(
    await tx.execute(
      sql`select identity_origin as origin from work_template_invocation_head where id=${headId} and organization_id=${organizationId}`,
    ),
  );
  if (!row?.origin) throw new ConflictError('Private definition identity requires resolution.');
}
async function exactRootPublications(
  tx: TemplateTransaction,
  organizationId: string,
  document: CanonicalPrivateWorkDefinition,
  definition: ProcessDefinitionCreate,
): Promise<ReadonlyMap<string, PrivateDefinitionRootPublication>> {
  const aliases = new Map(
    document.sourceMappings.map((mapping) => [mapping.sourceKey, mapping.alias]),
  );
  const sources = compilePrivateDefinitionSources(definition, aliases),
    publications = new Map<string, PrivateDefinitionRootPublication>(),
    graphs = [];
  for (const source of sources.filter((entry) => entry.id === entry.rootId)) {
    const root = document.roots.find((entry) => entry.key === source.key);
    if (!root?.template || source.kind === 'milestone' || root.template.selection.kind !== 'pinned')
      throw new ConflictError('Private root publication is unavailable.');
    const graph = await readBlueprintClosure(tx, {
      organizationId,
      kind: source.kind,
      workTypeId: root.template.workTypeId,
      workTypeVersionId: root.template.selection.workTypeVersionId,
    });
    await assertAuthoredPublication(tx, source, sources, definition, graph.root);
    graphs.push(graph);
    publications.set(source.id, {
      workTypeId: graph.root.workTypeId,
      workTypeVersionId: graph.root.versionId,
    });
  }
  await lockBlueprintClosures(tx, graphs);
  return publications;
}
async function assertAuthoredPublication(
  tx: TemplateTransaction,
  source: RecurrenceBlueprintSource,
  sources: readonly RecurrenceBlueprintSource[],
  definition: ProcessDefinitionCreate,
  publication: {
    readonly workTypeId: string;
    readonly versionId: string;
    readonly definition: unknown;
  },
): Promise<void> {
  const selected = source.preset.fields['work_type_id'],
    version = source.preset.fields['work_type_version_id'];
  if (typeof selected === 'string') {
    if (selected !== publication.workTypeId || version !== publication.versionId)
      throw new ConflictError('Private selected publication changed.');
    return;
  }
  if (source.kind === 'task' && sources.length === 1) {
    const [base] = await tx
      .select({ id: template.id })
      .from(template)
      .where(and(eq(template.id, publication.workTypeId), eq(template.isBase, true)))
      .limit(1);
    if (!base) throw new ConflictError('Private base publication changed.');
    return;
  }
  if (
    blueprintFingerprint(publication.definition) !==
    blueprintFingerprint(recurrenceWorkTemplateDefinition(definition.name, source, sources))
  )
    throw new ConflictError('Private structural publication changed.');
}
async function recompile(
  tx: TemplateTransaction,
  organizationId: string,
  document: CanonicalPrivateWorkDefinition,
): Promise<void> {
  const definition = ProcessDefinitionCreate.parse(document.authoring.definition);
  const publications = await exactRootPublications(tx, organizationId, document, definition);
  const expected = compileAuthoredPrivateDefinition({
    definitionAlias: document.authoring.definitionAlias,
    revisionAlias: document.authoring.revisionAlias,
    definition,
    aliases: new Map(document.sourceMappings.map((mapping) => [mapping.sourceKey, mapping.alias])),
    publications,
  });
  if (hashScheduleArchive(expected) !== hashScheduleArchive(document))
    throw new ConflictError('Private definition compilation evidence changed.');
}
function publishedHead(head: Awaited<ReturnType<typeof canonicalDefinitionHead>>): {
  readonly id: string;
  readonly publishedInvocationId: string;
} {
  if (!head || head.archivedAt || head.status === 'archived' || !head.publishedInvocationId)
    throw new NotFoundError('Published process definition not found');
  return { id: head.id, publishedInvocationId: head.publishedInvocationId };
}
/**
 * Read the actual registered published pointer after current private-head authorization and immutable body proof.
 * Independently recompile fields/selection/title/completion before registering a capability; a SQL hash is not compiler authority.
 * @throws For hidden/archived/unresolved heads, changed immutable publication, or forged candidate fields.
 */
export async function loadCanonicalPrivatePublication(
  tx: TemplateTransaction,
  input: LegacyDefinitionAccessRequest,
): Promise<CanonicalPrivatePublicationBinding> {
  if (!input.actorId) throw new NotFoundError('Process definition not found');
  await requireLegacyDefinitionAccess(tx, input);
  await requireNamespace(tx);
  const head = publishedHead(await canonicalDefinitionHead(tx, input, 'share'));
  await requireHeadOrigin(tx, head.id, input.organizationId);
  const [row] = await tx
    .select({ revision: invocationRevision, manifest: blueprintInvocation.manifest })
    .from(invocationRevision)
    .innerJoin(
      blueprintInvocation,
      and(
        eq(blueprintInvocation.id, invocationRevision.invocationId),
        eq(blueprintInvocation.organizationId, invocationRevision.organizationId),
      ),
    )
    .where(
      and(
        eq(invocationRevision.headId, head.id),
        eq(invocationRevision.organizationId, input.organizationId),
        eq(invocationRevision.invocationId, head.publishedInvocationId),
        eq(invocationRevision.state, 'published'),
        eq(invocationRevision.origin, 'authored'),
      ),
    )
    .limit(1);
  const parsed = CanonicalPrivateWorkDefinition.safeParse(row?.manifest);
  if (
    !row ||
    !parsed.success ||
    parsed.data.state !== 'published' ||
    row.revision.authoredPayloadHash !== hashScheduleArchive(row.manifest) ||
    parsed.data.authoring.definitionAlias !== head.id ||
    parsed.data.authoring.revisionAlias !== row.revision.id
  )
    throw new ConflictError('Private authored publication is unavailable.');
  await recompile(tx, input.organizationId, parsed.data);
  const binding = Object.freeze({ proof: {} });
  bindings.set(binding, {
    tx,
    organizationId: input.organizationId,
    actorId: input.actorId,
    definitionId: head.id,
    revisionId: row.revision.id,
    invocationId: row.revision.invocationId,
    document: parsed.data,
  });
  return binding;
}
/** Exact checked aliases and body for the owning transaction/caller; this is not an activation receipt. */
export function requireCanonicalPrivatePublication(
  tx: TemplateTransaction,
  caller: Pick<ActorCtx, 'orgId' | 'actorId'>,
  binding: CanonicalPrivatePublicationBinding,
): Readonly<CheckedCanonicalPrivatePublication> {
  const registered = bindings.get(binding);
  if (
    registered?.tx !== tx ||
    registered.organizationId !== caller.orgId ||
    registered.actorId !== caller.actorId
  )
    throw new CapabilityError();
  return {
    definitionId: registered.definitionId,
    revisionId: registered.revisionId,
    invocationId: registered.invocationId,
    document: structuredClone(registered.document),
  };
}
/** Bind one checked timezone-neutral publication to a future schedule context without saving a claim or changing source. */
export function bindCanonicalPrivateSchedule(
  tx: TemplateTransaction,
  caller: Pick<ActorCtx, 'orgId' | 'actorId'>,
  binding: CanonicalPrivatePublicationBinding,
  timezone: string,
): WorkScheduleForestV2 {
  const { document } = requireCanonicalPrivatePublication(tx, caller, binding);
  return WorkScheduleForestV2.parse({
    kind: 'forest',
    revision: 2,
    state: 'published',
    creationMode: document.creationMode,
    roots: document.roots.map((root) => ({
      key: root.key,
      draft: {
        kind: 'schedule',
        revision: 1,
        template: root.template,
        root: root.root,
        stepOverrides: root.stepOverrides,
        optionalChoices: root.optionalChoices,
        titlePattern: 'Private work',
        timezone: ScheduleTimezone.parse(timezone),
      },
    })),
    dependencies: document.dependencies,
    timing: document.timing,
    absentFields: document.absentFields,
    titlePolicy: document.titlePolicy,
    titles: document.titles,
    completionPolicy: document.completionPolicy,
    ...(document.placements ? { placements: document.placements } : {}),
  });
}
