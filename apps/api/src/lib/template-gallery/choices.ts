import { canActor } from '@docket/authz';
import { label, team } from '@docket/db';
import type { WorkTemplateGalleryPreviewRequest } from '@docket/work/template-gallery-contract';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { CapabilityError, NotFoundError } from '../../error';
import { mayManageTemplateOfferings, type TemplateActor } from '../templates/authorization';
import type { TemplateTransaction } from '../templates/persistence';

/** Recheck actual destination labels and offerings without inheriting catalog suggestions by name. */
export async function requireGalleryChoices(
  tx: TemplateTransaction,
  caller: TemplateActor,
  body: WorkTemplateGalleryPreviewRequest,
): Promise<void> {
  const ids = [...new Set(body.labels.map((choice) => choice.destinationLabelId))];
  if (ids.length) {
    const rows = await tx
      .select({ id: label.id, teamId: label.teamId })
      .from(label)
      .where(and(eq(label.organizationId, caller.orgId), inArray(label.id, ids)));
    if (rows.length !== ids.length) throw new NotFoundError('Label not found');
    for (const teamId of new Set(rows.flatMap((row) => (row.teamId ? [row.teamId] : [])))) {
      const access = await canActor(
        caller.actorId,
        'view',
        { kind: 'team', id: teamId, orgId: caller.orgId },
        tx,
      );
      if (!access.allow) throw new NotFoundError('Label not found');
    }
  }
  if (!body.offerings.some((choice) => choice.teamIds.length)) return;
  if (!(await mayManageTemplateOfferings(caller, tx))) throw new CapabilityError();
  const teamIds = [...new Set(body.offerings.flatMap((choice) => choice.teamIds))];
  const rows = await tx
    .select({ id: team.id })
    .from(team)
    .where(
      and(
        eq(team.organizationId, caller.orgId),
        inArray(team.id, teamIds),
        isNull(team.archivedAt),
      ),
    );
  if (rows.length !== teamIds.length) throw new NotFoundError('Team not found');
}
