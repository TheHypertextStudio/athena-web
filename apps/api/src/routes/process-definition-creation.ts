/** Retry-safe project snapshots through the existing publication writer and canonical receipt. */
import {
  blueprintConversion,
  blueprintInvocation,
  db,
  processRevision,
  invocationRevision,
} from '@docket/db';
import { and, eq } from 'drizzle-orm';
import type { Context, MiddlewareHandler } from 'hono';
import type { AppEnv } from '../context';
import { ConflictError } from '../error';
import {
  ProcessDefinitionDetailOut,
  ProcessDefinitionFromProjectCreate,
} from '../contracts/recurrence';
import { completeIdempotencyInTransaction } from '../lib/idempotency';
import { captureLegacyProjectSource } from '../lib/recurrence/legacy-source-capture';
import {
  createProcessDefinitionFromProjectInTransaction,
  loadProcessDefinitionDetail,
} from '../lib/recurrence/process-definition';
import { reconcileTemplateCreationEffects } from '../lib/templates/service';

/** Recheck the current source tree before a key can replay any private snapshot prose. */
export const authorizeProjectSnapshot: MiddlewareHandler<AppEnv> = async (c, next) => {
  const { orgId, actorId } = c.get('actorCtx');
  const input = ProcessDefinitionFromProjectCreate.parse(await c.req.json());
  await captureLegacyProjectSource(
    db,
    {
      organizationId: orgId,
      actorId,
      projectId: input.projectId,
    },
    async () => undefined,
  );
  await next();
};

/**
 * Capture source, publish canonical roots, and complete the optional receipt under one commit.
 * @param c - Authorized workspace context and optional claimed retry key.
 * @param input - Validated source project and snapshot options.
 * @returns The validated private definition response.
 */
export async function createProjectSnapshotWithReceipt(
  c: Context<AppEnv>,
  input: ProcessDefinitionFromProjectCreate,
): Promise<ProcessDefinitionDetailOut> {
  const { orgId, actorId } = c.get('actorCtx');
  const claim = c.get('idempotencyClaim');
  const result = await captureLegacyProjectSource(
    db,
    {
      organizationId: orgId,
      actorId,
      projectId: input.projectId,
    },
    async (tx) => {
      const published = await createProcessDefinitionFromProjectInTransaction(tx, {
        organizationId: orgId,
        actorId,
        input,
      });
      const response = ProcessDefinitionDetailOut.parse(
        await loadProcessDefinitionDetail(tx, orgId, published.definitionId, actorId),
      );
      if (claim)
        await completeIdempotencyInTransaction(tx, claim, {
          organizationId: orgId,
          responseStatus: 200,
          responseBody: response,
          responseHeaders: { 'content-type': 'application/json' },
        });
      return { response, effects: published.templateEffects };
    },
  );
  if (claim) c.set('idempotencyCompleted', true);
  await reconcileTemplateCreationEffects(result.effects);
  return result.response;
}

/** Reauthorize the result on replay and resume idempotent image work after a post-commit failure. */
export const resumeProjectSnapshot: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  if (c.res.status !== 200 || c.res.headers.get('Idempotency-Replayed') !== 'true') return;
  const response = ProcessDefinitionDetailOut.parse(await c.res.clone().json());
  const { orgId, actorId } = c.get('actorCtx');
  await loadProcessDefinitionDetail(db, orgId, response.id, actorId);
  const registered = await db
    .select({ manifest: blueprintInvocation.manifest })
    .from(invocationRevision)
    .innerJoin(
      blueprintInvocation,
      and(
        eq(blueprintInvocation.id, invocationRevision.invocationId),
        eq(blueprintInvocation.organizationId, orgId),
      ),
    )
    .where(
      and(
        eq(invocationRevision.id, response.revision.id),
        eq(invocationRevision.headId, response.id),
        eq(invocationRevision.organizationId, orgId),
      ),
    );
  const rows = registered.length
    ? registered
    : await db
        .select({ manifest: blueprintInvocation.manifest })
        .from(blueprintInvocation)
        .innerJoin(
          blueprintConversion,
          and(
            eq(blueprintConversion.invocationId, blueprintInvocation.id),
            eq(blueprintConversion.organizationId, orgId),
          ),
        )
        .innerJoin(
          processRevision,
          and(
            eq(processRevision.id, blueprintConversion.legacyProcessRevisionId),
            eq(processRevision.organizationId, orgId),
          ),
        )
        .where(
          and(
            eq(blueprintInvocation.organizationId, orgId),
            eq(processRevision.definitionId, response.id),
            eq(processRevision.id, response.revision.id),
          ),
        );
  await reconcileTemplateCreationEffects(
    rows.flatMap(({ manifest }) => {
      if (manifest.kind === 'private_definition')
        return manifest.roots.flatMap((root) =>
          root.template
            ? [
                {
                  organizationId: orgId,
                  templateId: root.template.workTypeId,
                  operation: 'upsert' as const,
                },
              ]
            : [],
        );
      if (manifest.kind !== 'published' && manifest.kind !== 'pending_draft')
        throw new ConflictError('The process publication binding changed.');
      return manifest.roots.flatMap((root) =>
        root.workTypeId === null
          ? []
          : [{ organizationId: orgId, templateId: root.workTypeId, operation: 'upsert' as const }],
      );
    }),
  );
};
