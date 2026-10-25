/** Metadata for the explicit label-example picker, bounded by current tenant/team authority. */
import { db, label, labelGroup, teamMember, type Database } from '@docket/db';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { LabelTemplateSuggestionSources } from '@docket/work/template-gallery-contract';
import { BillingGraceExpiredError, CapabilityError, ProductRequiredError } from '../error';
import {
  requireTailoringAuthor,
  requireTailoringCaller,
  type TailoringCaller,
} from './template-tailoring-context';

/** Read only safe choices after current identity/Pro/policy checks; Free remains usable manually. */
export async function labelSuggestionSources(
  caller: TailoringCaller,
  database: Database = db,
): Promise<LabelTemplateSuggestionSources> {
  await requireTailoringCaller(caller, database);
  try {
    await requireTailoringAuthor(caller, database);
    return await availableSources(caller, database);
  } catch (error) {
    if (error instanceof ProductRequiredError || error instanceof BillingGraceExpiredError)
      return { availability: 'requires_pro', groups: [], labels: [] };
    if (error instanceof CapabilityError)
      return { availability: 'authoring_unavailable', groups: [], labels: [] };
    throw error;
  }
}
async function availableSources(
  caller: TailoringCaller,
  database: Database,
): Promise<LabelTemplateSuggestionSources> {
  const teams = database
    .select({ id: teamMember.teamId })
    .from(teamMember)
    .where(
      and(eq(teamMember.organizationId, caller.orgId), eq(teamMember.actorId, caller.actorId)),
    );
  const groups = await database
    .select({ id: labelGroup.id, name: labelGroup.name })
    .from(labelGroup)
    .where(
      and(
        eq(labelGroup.organizationId, caller.orgId),
        or(isNull(labelGroup.teamId), inArray(labelGroup.teamId, teams)),
      ),
    )
    .orderBy(labelGroup.name, labelGroup.id);
  if (!groups.length) return { availability: 'available', groups, labels: [] };
  const labels = await database
    .select({ id: label.id, groupId: label.groupId, name: label.name })
    .from(label)
    .where(
      and(
        eq(label.organizationId, caller.orgId),
        inArray(
          label.groupId,
          groups.map(({ id }) => id),
        ),
        or(isNull(label.teamId), inArray(label.teamId, teams)),
      ),
    )
    .orderBy(label.name, label.id);
  return LabelTemplateSuggestionSources.parse({
    availability: 'available',
    groups,
    labels: labels.flatMap((row) => (row.groupId ? [{ ...row, groupId: row.groupId }] : [])),
  });
}
