import { actor } from '@docket/db';
import { canActor } from '@docket/authz';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { ActorCtx } from '../../context';
import { CapabilityError, ConflictError, NotFoundError } from '../../error';
import { loadCreationActor } from '../work-creation/context';
import { requireTemplateAuthor } from './authorization';
import type { TemplateTransaction } from './persistence';

/** Verified request/session identity; adapters obtain userId from authenticated server context. */
export interface TemplateCopyPrincipal {
  readonly organizationId: string;
  readonly userId: string;
}
/** Independently resolve live destination membership and authoring from the verified user principal. */
export async function loadTemplateCopyActor(
  tx: TemplateTransaction,
  principal: TemplateCopyPrincipal,
  access: 'view' | 'author' = 'author',
): Promise<ActorCtx> {
  const [member] = await tx
    .select({ id: actor.id })
    .from(actor)
    .where(
      and(
        eq(actor.organizationId, principal.organizationId),
        eq(actor.userId, principal.userId),
        eq(actor.kind, 'human'),
        eq(actor.status, 'active'),
        isNull(actor.archivedAt),
      ),
    )
    .for('share');
  if (!member) throw new NotFoundError('Workspace not found');
  const live = await loadCreationActor(tx, principal.organizationId, member.id);
  const decision = await canActor(
    live.actorId,
    'view',
    { kind: 'organization', id: live.orgId, orgId: live.orgId },
    tx,
  );
  if (!decision.allow) throw new CapabilityError();
  if (access === 'author') await requireTemplateAuthor(live, tx);
  await installTemplateCopyContext(tx, live);
  return live;
}
/** Install only a freshly verified author on this transaction for narrow SQL reservation checks. */
export async function installTemplateCopyContext(
  tx: TemplateTransaction,
  live: Pick<ActorCtx, 'orgId' | 'actorId'>,
): Promise<void> {
  await tx.execute(
    sql`select set_config('docket.organization_id',${live.orgId},true),set_config('docket.actor_id',${live.actorId},true)`,
  );
}
/** Copy acceptance requires the existing retrying SERIALIZABLE transaction owner. */
export async function requireCopySerializable(tx: TemplateTransaction): Promise<void> {
  const result: unknown = await tx.execute(
    sql`select current_setting('transaction_isolation') as isolation`,
  );
  const rowSchema = z.array(z.object({ isolation: z.string() }));
  const rows = Array.isArray(result)
    ? rowSchema.parse(result)
    : z.object({ rows: rowSchema }).parse(result).rows;
  if (rows[0]?.isolation !== 'serializable')
    throw new ConflictError('Copy acceptance requires a serializable transaction');
}
