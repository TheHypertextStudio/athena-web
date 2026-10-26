import { blueprintInvocation, recurrenceSeries } from '@docket/db';
import { and, eq } from 'drizzle-orm';
import type { ActorCtx } from '../../context';
import { CapabilityError, ConflictError } from '../../error';
import type { TemplateTransaction } from '../templates/persistence';
import type { PrivateBlueprintStructure } from '../work-template-blueprints/resolve';
import type { OrdinaryWorkCommand, WorkCreationBatchCommand } from '../work-creation/types';
import {
  loadCanonicalPrivatePublication,
  requireCanonicalPrivateStructures,
  type CanonicalPrivatePublicationBinding,
} from './private-definition-binding';

/** Opaque reference to one root's verified private structure; it resolves only on its own transaction. */
export interface PrivateScheduleStructureGrant {
  readonly binding: CanonicalPrivatePublicationBinding;
  readonly rootKey: string;
}

/** Give each inline private root its structure grant from a binding loaded for this transaction and caller. */
export function attachPrivateScheduleStructures(
  tx: TemplateTransaction,
  caller: Pick<ActorCtx, 'orgId' | 'actorId'>,
  command: WorkCreationBatchCommand,
  binding: CanonicalPrivatePublicationBinding,
): WorkCreationBatchCommand {
  const keys = new Set(
    requireCanonicalPrivateStructures(tx, caller, binding).map((entry) => entry.rootKey),
  );
  return {
    ...command,
    roots: command.roots.map((entry) => {
      const context = entry.command.invocation.scheduleContext;
      if (!keys.has(entry.key) || !context) return entry;
      return {
        ...entry,
        command: {
          ...entry.command,
          invocation: {
            ...entry.command.invocation,
            scheduleContext: { ...context, privateStructure: { binding, rootKey: entry.key } },
          },
        },
      };
    }),
  };
}

/** Persisted run facts that identify a schedule revision's source invocation. */
export interface PersistedPrivateScheduleSource {
  readonly organizationId: string;
  readonly seriesId: string;
  readonly invocationId: string | null;
}

/**
 * Reload a private run's structure through the publication factory as the series creator.
 * Non-private revisions are returned unchanged; a private revision that cannot be verified is refused.
 * @throws ConflictError When the private source is unavailable to its creator.
 */
export async function attachPersistedPrivateScheduleStructures(
  tx: TemplateTransaction,
  command: WorkCreationBatchCommand,
  source: PersistedPrivateScheduleSource,
): Promise<WorkCreationBatchCommand> {
  if (!source.invocationId) return command;
  const [invocation] = await tx
    .select({ manifest: blueprintInvocation.manifest })
    .from(blueprintInvocation)
    .where(
      and(
        eq(blueprintInvocation.id, source.invocationId),
        eq(blueprintInvocation.organizationId, source.organizationId),
      ),
    )
    .limit(1);
  if (invocation?.manifest.kind !== 'private_definition') return command;
  const [series] = await tx
    .select({ definitionId: recurrenceSeries.definitionId, createdBy: recurrenceSeries.createdBy })
    .from(recurrenceSeries)
    .where(
      and(
        eq(recurrenceSeries.id, source.seriesId),
        eq(recurrenceSeries.organizationId, source.organizationId),
      ),
    )
    .limit(1);
  if (!series?.definitionId || !series.createdBy)
    throw new ConflictError('The private schedule publication is unavailable.');
  const binding = await loadCanonicalPrivatePublication(tx, {
    organizationId: source.organizationId,
    actorId: series.createdBy,
    definitionId: series.definitionId,
    invocationId: source.invocationId,
  });
  return attachPrivateScheduleStructures(
    tx,
    { orgId: source.organizationId, actorId: series.createdBy },
    command,
    binding,
  );
}

/**
 * Resolve the root's private structure for the shared planner, only on the grant's own transaction.
 * @throws CapabilityError For a grant from another transaction or caller, or an unknown root.
 */
export function privateStructureForCommand(
  tx: TemplateTransaction,
  command: OrdinaryWorkCommand,
): PrivateBlueprintStructure | undefined {
  const grant = command.invocation.scheduleContext?.privateStructure;
  if (!grant) return undefined;
  const { orgId, actorId } = command.caller;
  if (!actorId) throw new CapabilityError();
  const structure = requireCanonicalPrivateStructures(tx, { orgId, actorId }, grant.binding).find(
    (entry) => entry.rootKey === grant.rootKey,
  );
  if (!structure) throw new CapabilityError();
  return {
    invocationId: structure.invocationId,
    definition: structure.definition,
    stepAliases: structure.stepAliases,
  };
}
