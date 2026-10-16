import { template, workTemplateCopyBundle, workTemplateCopyEntry } from '@docket/db';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { WorkTemplateCopyBundle } from '@docket/work/template-gallery-contract';
import type { WorkTemplateOut } from '@docket/work/work-template-contract';
import { ConflictError, NotFoundError } from '../../error';
import { serializableTx } from '../serializable-tx';
import {
  loadTemplateCopyActor,
  type TemplateCopyPrincipal,
} from '../templates/copy-reservation-context';
import {
  getTemplateCopyBundleForRequest,
  type TemplateCopyEntryRow,
} from '../templates/copy-reservation';
import { toWorkTemplateOut } from '../templates/projection';
import { visibleTemplateWhere } from '../templates/visibility';
import { galleryCopyReceipt } from './acceptance-facts';

function dependencies(
  entry: TemplateCopyEntryRow,
  byKey: ReadonlyMap<string, TemplateCopyEntryRow>,
): string[] {
  return entry.dependencyEntryKeys.map((key) => {
    const checked = byKey.get(key);
    if (!checked) throw new ConflictError('Copy outcome is unavailable');
    return checked.destinationWorkTypeId;
  });
}

/**
 * Reenter only the active acceptor's saved bundle, using current authorized canonical definitions.
 * @throws When current membership/view rights fail or this is another person's saved bundle.
 */
export async function readTemplateGalleryCopyBundle(
  principal: TemplateCopyPrincipal,
  bundleId: string,
): Promise<WorkTemplateCopyBundle> {
  const read = await serializableTx(async (tx) => {
    const live = await loadTemplateCopyActor(tx, principal, 'view');
    const [bundle] = await tx
      .select()
      .from(workTemplateCopyBundle)
      .where(
        and(
          eq(workTemplateCopyBundle.organizationId, live.orgId),
          eq(workTemplateCopyBundle.acceptingActorKey, live.actorId),
          eq(workTemplateCopyBundle.id, bundleId),
        ),
      )
      .limit(1);
    if (!bundle) throw new NotFoundError('Copy bundle not found');
    const status = await getTemplateCopyBundleForRequest(tx, principal, bundle.requestId);
    if (!status) throw new NotFoundError('Copy bundle not found');
    const entries = await tx
      .select()
      .from(workTemplateCopyEntry)
      .where(
        and(
          eq(workTemplateCopyEntry.organizationId, live.orgId),
          eq(workTemplateCopyEntry.bundleId, bundle.id),
        ),
      )
      .orderBy(asc(workTemplateCopyEntry.ordinal));
    const rows = await tx
      .select()
      .from(template)
      .where(
        and(
          visibleTemplateWhere(live.orgId, live.actorId, {
            includeArchived: true,
            includeBase: false,
          }),
          inArray(
            template.id,
            entries.map((entry) => entry.destinationWorkTypeId),
          ),
        ),
      );
    return { live, status, entries, rows };
  });
  // Canonical projection uses the ordinary database pool; drain it after the read transaction.
  const projected = await Promise.all(read.rows.map((row) => toWorkTemplateOut(read.live, row)));
  const byId = new Map<string, WorkTemplateOut>(projected.map((row) => [row.id, row]));
  const byKey = new Map(read.entries.map((entry) => [entry.entryKey, entry]));
  const roots = new Set(read.status.rootEntryKeys);
  return WorkTemplateCopyBundle.parse({
    receipt: galleryCopyReceipt(read.status),
    entries: read.entries.map((entry) => ({
      key: entry.entryKey,
      isRoot: roots.has(entry.entryKey),
      workTypeId: entry.destinationWorkTypeId,
      template: byId.get(entry.destinationWorkTypeId) ?? null,
      catalogOrigin: entry.sourceIdentity.kind === 'catalog' ? entry.sourceIdentity : null,
      dependencies: dependencies(entry, byKey),
      reservation: {
        state: entry.reservationState,
        reservedFirstPublicationId: entry.reservedFirstVersionId,
      },
    })),
  });
}
