import { canActor } from '@docket/authz';
import { actor } from '@docket/db';
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { ActorCtx } from '../../context';
import { CapabilityError, NotFoundError } from '../../error';
import { loadCreationActor } from '../work-creation/context';
import {
  installTemplateCopyContext,
  loadTemplateCopyActor,
  requireCopySerializable,
  type TemplateCopyPrincipal,
} from './copy-reservation-context';
import type { TemplateTransaction } from './persistence';

/** Actual persisted bundle/member binding; caller-provided exclusion lists are never accepted. */
export interface TemplateCopyMemberBinding {
  readonly bundleId: string;
  readonly entryKey: string;
}
/** Minimal pending identity, distinct from an actual publication. */
export interface TemplateCopyPendingSelection {
  readonly reservedFirstVersionId: string;
}
async function liveViewer(
  tx: TemplateTransaction,
  input: Pick<ActorCtx, 'orgId' | 'actorId'>,
): Promise<void> {
  const [member] = await tx
    .select({ id: actor.id })
    .from(actor)
    .where(
      and(
        eq(actor.id, input.actorId),
        eq(actor.organizationId, input.orgId),
        eq(actor.status, 'active'),
        isNull(actor.archivedAt),
      ),
    )
    .for('share');
  if (!member) throw new NotFoundError('Workspace not found');
  const live = await loadCreationActor(tx, input.orgId, member.id);
  if (
    !(
      await canActor(
        live.actorId,
        'view',
        { kind: 'organization', id: live.orgId, orgId: live.orgId },
        tx,
      )
    ).allow
  )
    throw new CapabilityError();
  await installTemplateCopyContext(tx, live);
}
async function booleanResult(tx: TemplateTransaction, query: SQL): Promise<boolean> {
  const result: unknown = await tx.execute(query);
  const rows = z.array(z.object({ value: z.boolean() }));
  const parsed = Array.isArray(result) ? rows.parse(result) : z.object({ rows }).parse(result).rows;
  return parsed[0]?.value === true;
}
/** Check exact current references after earlier lawful removals, inside the owner's sorted locked bundle transaction. */
export async function templateCopyBundleMemberInUse(
  tx: TemplateTransaction,
  principal: TemplateCopyPrincipal,
  binding: TemplateCopyMemberBinding,
): Promise<boolean> {
  await requireCopySerializable(tx);
  await loadTemplateCopyActor(tx, principal);
  return booleanResult(
    tx,
    sql`select docket_copy_bundle_member_in_use(${principal.organizationId},${binding.bundleId},${binding.entryKey}) as value`,
  );
}
/** Read a visible pending reservation without authoring or exposing private copy provenance. */
export async function templateCopyPendingSelection(
  tx: TemplateTransaction,
  input: Pick<ActorCtx, 'orgId' | 'actorId'>,
  templateId: string,
): Promise<TemplateCopyPendingSelection | null> {
  if (
    !(await booleanResult(
      tx,
      sql`select docket_template_has_copy_reservation(${input.orgId},${templateId}) as value`,
    ))
  )
    return null;
  await liveViewer(tx, input);
  const result: unknown = await tx.execute(
    sql`select * from docket_template_copy_pending_selection(${input.orgId},${templateId})`,
  );
  const rows = z.array(
    z.object({ reserved_first_version_id: z.string(), reservation_state: z.literal('pending') }),
  );
  const parsed = Array.isArray(result) ? rows.parse(result) : z.object({ rows }).parse(result).rows;
  const row = parsed[0];
  return row ? { reservedFirstVersionId: row.reserved_first_version_id } : null;
}
/** Prevent a protected receipt from falling through ordinary Undo even when its acceptor-private bundle is hidden. */
export async function templateCopyReceiptRegistered(
  tx: TemplateTransaction,
  input: Pick<ActorCtx, 'orgId' | 'actorId'>,
  receiptKey: string,
): Promise<boolean> {
  await liveViewer(tx, input);
  return booleanResult(
    tx,
    sql`select docket_copy_receipt_registered(${input.orgId},${receiptKey}) as value`,
  );
}
/** Check private usage for an already authorized ordinary template mutation. */
export async function templateReferencesInUse(
  tx: TemplateTransaction,
  input: Pick<ActorCtx, 'orgId' | 'actorId'>,
  templateId: string,
): Promise<boolean> {
  await liveViewer(tx, input);
  return booleanResult(
    tx,
    sql`select docket_copy_template_in_use(${input.orgId},${templateId}) as value`,
  );
}

/** Internal routing discriminator only; true grants no caller or bundle authority. */
export async function templateChangeSetHasCopyBundle(
  tx: TemplateTransaction,
  orgId: string,
  receiptKey: string,
): Promise<boolean> {
  return booleanResult(
    tx,
    sql`select docket_change_set_has_copy_bundle(${orgId},${receiptKey}) as value`,
  );
}
