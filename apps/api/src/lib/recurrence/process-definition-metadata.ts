/** Canonical-owned process metadata with legacy normalized compatibility for unregistered sources. */
import { processDefinition, processRevision, invocationRevision, type Database } from '@docket/db';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import {
  ProcessDefinitionSummaryOut,
  type ProcessDefinitionDetailOut,
  ProcessDefinitionUpdate,
} from '../../contracts/recurrence';
import { ConflictError, NotFoundError } from '../../error';
import { canonicalDefinitionHead, updateCanonicalDefinitionMetadata } from './canonical-definition';
import { requireLegacyDefinitionAccess } from './legacy-definition-access';
import { listActiveProcessDefinitionRows } from './list-store';
import { loadProcessDefinitionDetail } from './process-definition';
/** List active org-scoped process definitions as compact latest-revision summaries. */
export async function listProcessDefinitions(
  database: Database,
  organizationId: string,
  pagination: { readonly cursor?: string | undefined; readonly limit: number },
  actorId: string | undefined,
): Promise<z.input<typeof ProcessDefinitionSummaryOut>[]> {
  const definitions = await listActiveProcessDefinitionRows(
    database,
    organizationId,
    actorId,
    pagination,
  );
  return Promise.all(
    definitions.map(async (definition) => {
      const head = await canonicalDefinitionHead(database, {
        organizationId,
        definitionId: definition.id,
      });
      const latest = head
        ? await database
            .select({ number: invocationRevision.number })
            .from(invocationRevision)
            .where(
              and(
                eq(invocationRevision.headId, head.id),
                eq(invocationRevision.organizationId, organizationId),
              ),
            )
            .orderBy(desc(invocationRevision.number))
            .limit(1)
        : await database
            .select({ number: processRevision.number })
            .from(processRevision)
            .where(eq(processRevision.definitionId, definition.id))
            .orderBy(desc(processRevision.number))
            .limit(1);
      const number = latest[0]?.number;
      if (!number) throw new ConflictError('Process definition has no published revision');
      return ProcessDefinitionSummaryOut.parse({
        id: definition.id,
        organizationId: definition.organizationId,
        name: definition.name,
        description: definition.description,
        status: definition.status,
        latestRevisionNumber: number,
        createdAt: definition.createdAt.toISOString(),
        updatedAt: definition.updatedAt.toISOString(),
      });
    }),
  );
}

/** Update mutable definition metadata without rewriting executable revision history. */
export async function updateProcessDefinitionMetadata(
  database: Database,
  command: {
    readonly organizationId: string;
    readonly actorId: string | undefined;
    readonly definitionId: string;
    readonly patch: z.input<typeof ProcessDefinitionUpdate>;
  },
): Promise<z.input<typeof ProcessDefinitionDetailOut>> {
  await requireLegacyDefinitionAccess(database, command, 'manage');
  const patch = ProcessDefinitionUpdate.parse(command.patch);
  if (await updateCanonicalDefinitionMetadata(database, command, patch))
    return loadProcessDefinitionDetail(
      database,
      command.organizationId,
      command.definitionId,
      command.actorId,
    );
  const updated = await database
    .update(processDefinition)
    .set({
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.description === undefined ? {} : { description: patch.description }),
    })
    .where(
      and(
        eq(processDefinition.id, command.definitionId),
        eq(processDefinition.organizationId, command.organizationId),
        isNull(processDefinition.archivedAt),
      ),
    )
    .returning({ id: processDefinition.id });
  if (!updated[0]) throw new NotFoundError('Process definition not found');
  return loadProcessDefinitionDetail(
    database,
    command.organizationId,
    command.definitionId,
    command.actorId,
  );
}
