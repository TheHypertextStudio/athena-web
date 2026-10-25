import {
  blueprintInvocation,
  genId,
  hashScheduleArchive,
  invocationHead,
  invocationRevision,
  type Database,
} from '@docket/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { canActor } from '@docket/authz';
import type { ProcessDefinitionCreate } from '../../contracts/recurrence';
import { CapabilityError, ConflictError, NotFoundError } from '../../error';
import { loadCreationActor } from '../work-creation/context';
import {
  reconcileTemplateCreationEffects,
  type TemplateCreationEffect,
} from '../templates/service';
import type { TemplateTransaction } from '../templates/persistence';
import { requireLegacyDefinitionAccess } from './legacy-definition-access';
import { canonicalDefinitionHead } from './canonical-definition';
import { validateProcessDefinitionGraph } from './process-definition-graph';
import {
  validateProcessDefinitionReferences,
  type PublishedProcessRevision,
  type PublishedProcessRevisionWithEffects,
} from './process-definition';
import { prepareProcessTemplates, type PreparedProcessDefinition } from './task-template-identity';
import { compilePrivateDefinitionSources } from './private-definition-source';
import { compileAuthoredPrivateDefinition } from './private-definition-compiler';
import { publishPrivateDefinitionRoots } from './private-definition-root-publication';

/** Canonical-only authored revision request; no raw invocation or source proof can be supplied. */
export interface CanonicalPrivateDefinitionCommand {
  readonly organizationId: string;
  readonly actorId: string;
  readonly definition: ProcessDefinitionCreate;
}
/** Existing checked private head receiving a new immutable authored revision. */
export interface AppendCanonicalPrivateDefinitionCommand extends CanonicalPrivateDefinitionCommand {
  readonly definitionId: string;
}
interface Publication extends PublishedProcessRevision {
  readonly effects: readonly TemplateCreationEffect[];
}
async function requirePrivateDefinitionAuthor(
  tx: TemplateTransaction,
  organizationId: string,
  actorId: string,
): Promise<void> {
  const decision = await canActor(
    actorId,
    'contribute',
    { kind: 'organization', id: organizationId, orgId: organizationId },
    tx,
  );
  if (!decision.allow) throw new CapabilityError();
}
function aliases(definition: PreparedProcessDefinition): ReadonlyMap<string, string> {
  return new Map(
    [
      ...(definition.project ? [definition.project.key] : []),
      ...definition.milestones.map((step) => step.key),
      ...definition.tasks.map((step) => step.key),
    ].map((key) => [key, genId()]),
  );
}
async function nextPublicationNumber(
  tx: TemplateTransaction,
  organizationId: string,
  headId: string,
): Promise<number> {
  const [previous] = await tx
    .select({ number: invocationRevision.number })
    .from(invocationRevision)
    .where(
      and(
        eq(invocationRevision.organizationId, organizationId),
        eq(invocationRevision.headId, headId),
      ),
    )
    .orderBy(desc(invocationRevision.number))
    .limit(1);
  return (previous?.number ?? 0) + 1;
}
async function publish(
  tx: TemplateTransaction,
  input: CanonicalPrivateDefinitionCommand,
  definition: PreparedProcessDefinition,
  head: typeof invocationHead.$inferSelect,
): Promise<Publication> {
  const caller = await loadCreationActor(tx, input.organizationId, input.actorId);
  await requirePrivateDefinitionAuthor(tx, input.organizationId, caller.actorId);
  validateProcessDefinitionGraph(definition);
  await validateProcessDefinitionReferences(tx, input.organizationId, definition);
  const sourceAliases = aliases(definition),
    revisionId = genId();
  const sources = compilePrivateDefinitionSources(definition, sourceAliases);
  const published = await publishPrivateDefinitionRoots(tx, caller, definition.name, sources);
  const document = compileAuthoredPrivateDefinition({
    definitionAlias: head.id,
    revisionAlias: revisionId,
    definition,
    aliases: sourceAliases,
    publications: published.publications,
  });
  const number = await nextPublicationNumber(tx, input.organizationId, head.id),
    now = new Date();
  const [invocation] = await tx
    .insert(blueprintInvocation)
    .values({
      organizationId: input.organizationId,
      ownerActorId: head.ownerActorId,
      manifest: document,
      overrides: [],
    })
    .returning({ id: blueprintInvocation.id });
  if (!invocation) throw new ConflictError('Private authored publication was not created.');
  await tx.insert(invocationRevision).values({
    id: revisionId,
    organizationId: input.organizationId,
    headId: head.id,
    invocationId: invocation.id,
    number,
    state: 'published',
    creationMode: definition.creationMode,
    origin: 'authored',
    originalSourceFingerprint: null,
    sourceArchiveHash: null,
    authoredPayloadHash: hashScheduleArchive(document),
    projection: sql`docket_authored_invocation_projection(${JSON.stringify(document)}::jsonb)`,
    createdBy: input.actorId,
    createdAt: now,
    publishedAt: now,
  });
  await tx
    .update(invocationHead)
    .set({
      name: definition.name,
      description: definition.description ?? null,
      status: 'published',
      canonicalAuthoringAt: head.canonicalAuthoringAt ?? now,
      draftInvocationId: invocation.id,
      publishedInvocationId: invocation.id,
      revision: head.revision + 1,
    })
    .where(
      and(eq(invocationHead.id, head.id), eq(invocationHead.organizationId, input.organizationId)),
    );
  return {
    definitionId: head.id,
    revisionId,
    revisionNumber: number,
    stepIdsByKey: Object.fromEntries(sourceAliases),
    effects: published.effects,
  };
}
/**
 * Create a private canonical publication using existing template preparation and immutable registry guards.
 * This internal authoring service creates no work, schedule, legacy row or retained conversion proof.
 * @throws For absent current authoring rights, foreign references or invalid immutable publication.
 */
export async function createCanonicalPrivateDefinition(
  database: Database,
  input: CanonicalPrivateDefinitionCommand,
): Promise<PublishedProcessRevision> {
  const result = await database.transaction((tx) =>
    createCanonicalPrivateDefinitionInTransaction(tx, input),
  );
  await reconcileTemplateCreationEffects(result.templateEffects);
  const { templateEffects: _effects, ...identity } = result;
  return identity;
}
/** Publish within an authorized enclosing capture transaction; its owner drains the returned effects after commit. */
export async function createCanonicalPrivateDefinitionInTransaction(
  tx: TemplateTransaction,
  input: CanonicalPrivateDefinitionCommand,
): Promise<PublishedProcessRevisionWithEffects> {
  const caller = await loadCreationActor(tx, input.organizationId, input.actorId);
  await requirePrivateDefinitionAuthor(tx, input.organizationId, caller.actorId);
  const definition = await prepareProcessTemplates(tx, input.organizationId, input.definition);
  validateProcessDefinitionGraph(definition);
  await validateProcessDefinitionReferences(tx, input.organizationId, definition);
  const [head] = await tx
    .insert(invocationHead)
    .values({
      id: genId(),
      organizationId: input.organizationId,
      ownerActorId: input.actorId,
      createdBy: input.actorId,
      name: definition.name,
      description: definition.description,
      status: 'draft',
    })
    .returning();
  if (!head) throw new ConflictError('Private authored head was not created.');
  const { effects, ...identity } = await publish(tx, input, definition, head);
  return { ...identity, templateEffects: effects };
}
/** Append after current private-head authorization and its lock; publication number is independent of metadata CAS. */
export async function appendCanonicalPrivateDefinition(
  database: Database,
  input: AppendCanonicalPrivateDefinitionCommand,
): Promise<PublishedProcessRevision> {
  const result = await database.transaction(async (tx) => {
    await requireLegacyDefinitionAccess(tx, input, 'manage');
    const head = await canonicalDefinitionHead(tx, input, 'update');
    if (!head || head.archivedAt || head.status === 'archived')
      throw new NotFoundError('Process definition not found');
    const definition = await prepareProcessTemplates(tx, input.organizationId, input.definition);
    return publish(tx, input, definition, head);
  });
  await reconcileTemplateCreationEffects(result.effects);
  const { effects: _effects, ...identity } = result;
  return identity;
}
