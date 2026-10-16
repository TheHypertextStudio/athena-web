import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { CapabilityError, ConflictError } from '../../error';
import { loadCreationActor } from '../work-creation/context';
import { requireTemplateAuthor } from './authorization';
import { installTemplateCopyContext } from './copy-reservation-context';
import type { TemplateRow } from './model';
import type { TemplateTransaction } from './persistence';

interface PreparedFirstPublication {
  readonly organizationId: string;
  readonly actorId: string;
  readonly versionId: string;
}
const prepared = new WeakMap<TemplateTransaction, Map<string, PreparedFirstPublication>>();
const projectedRow = z.object({
  entry_id: z.string(),
  reserved_first_version_id: z.string(),
  reservation_state: z.enum(['pending', 'consumed', 'void']),
});

/**
 * Register a first-publication reservation before a compatible legacy writer promotes private scope.
 * The definition is already locked; proof binds exact transaction/identity/current author, not body.
 */
export async function prepareTemplateCopyPublication(
  tx: TemplateTransaction,
  row: TemplateRow,
  actorId: string,
): Promise<string | null> {
  if (row.latestPublishedVersionId || !(await hasCopyReservation(tx, row))) return null;
  const live = await loadCreationActor(tx, row.organizationId, actorId);
  await requireTemplateAuthor(live, tx);
  await installTemplateCopyContext(tx, live);
  const result: unknown = await tx.execute(
    sql`select * from docket_template_copy_reservation(${row.organizationId},${row.id})`,
  );
  const schema = z.array(projectedRow);
  const rows = Array.isArray(result)
    ? schema.parse(result)
    : z.object({ rows: schema }).parse(result).rows;
  const reservation = rows[0];
  if (!reservation) return null;
  if (reservation.reservation_state !== 'pending')
    throw new ConflictError('First publication reservation is unavailable');
  const byTemplate = prepared.get(tx) ?? new Map<string, PreparedFirstPublication>();
  byTemplate.set(row.id, {
    organizationId: row.organizationId,
    actorId,
    versionId: reservation.reserved_first_version_id,
  });
  prepared.set(tx, byTemplate);
  return reservation.reserved_first_version_id;
}

/** Choose a real reserved first ID only under current author proof; later versions remain ordinary. */
export async function reservedFirstPublicationId(
  tx: TemplateTransaction,
  row: TemplateRow,
  actorId: string | null,
): Promise<string | null> {
  if (row.latestPublishedVersionId || !(await hasCopyReservation(tx, row))) return null;
  const existing = prepared.get(tx)?.get(row.id);
  if (existing) {
    if (existing.organizationId !== row.organizationId || existing.actorId !== actorId)
      throw new CapabilityError();
    const live = await loadCreationActor(tx, row.organizationId, existing.actorId);
    await requireTemplateAuthor(live, tx);
    await installTemplateCopyContext(tx, live);
    return existing.versionId;
  }
  if (actorId !== null) return prepareTemplateCopyPublication(tx, row, actorId);
  const result: unknown = await tx.execute(
    sql`select * from docket_template_copy_reservation(${row.organizationId},${row.id})`,
  );
  const schema = z.array(projectedRow);
  const rows = Array.isArray(result)
    ? schema.parse(result)
    : z.object({ rows: schema }).parse(result).rows;
  if (rows.length > 0) throw new CapabilityError();
  return null;
}

/** Authorize legacy organization promotion before its existing scope-changing update removes team visibility. */
export async function prepareTemplateCopyScopePublication(
  tx: TemplateTransaction,
  row: TemplateRow,
  actorId: string,
  scope: TemplateRow['scope'],
): Promise<void> {
  if (scope === 'organization') await prepareTemplateCopyPublication(tx, row, actorId);
}

async function hasCopyReservation(tx: TemplateTransaction, row: TemplateRow): Promise<boolean> {
  const result: unknown = await tx.execute(
    sql`select docket_template_has_copy_reservation(${row.organizationId},${row.id}) as reserved`,
  );
  const schema = z.array(z.object({ reserved: z.boolean() }));
  const rows = Array.isArray(result)
    ? schema.parse(result)
    : z.object({ rows: schema }).parse(result).rows;
  return rows[0]?.reserved ?? false;
}
