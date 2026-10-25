/** Optional source-group continuation is derived from the stored session, never a URL claim. */
import { labelGroup, label, sessionActivity, type Database } from '@docket/db';
import { and, eq, sql } from 'drizzle-orm';
import { LabelTemplateSuggestionRequest } from '@docket/work/template-gallery-contract';
import type { TemplateProposalReview } from '@docket/work/work-template-contract';
import type { TemplateRow } from '../lib/templates/model';
import { requireTemplateTeam } from '../lib/templates/authorization';
import { NotFoundError } from '../error';
import type { TailoringCaller } from './template-tailoring-context';

/** Offer separate conversion only for an actual publication and currently visible original group. */
export async function labelSuggestionContinuation(
  database: Database,
  caller: TailoringCaller,
  sessionId: string,
  draft: TemplateRow | null,
): Promise<TemplateProposalReview['labelConversion']> {
  if (draft?.publicationState !== 'published' || !draft.latestPublishedVersionId) return undefined;
  const [activity] = await database
    .select({ body: sessionActivity.body })
    .from(sessionActivity)
    .where(
      and(
        eq(sessionActivity.sessionId, sessionId),
        eq(sessionActivity.type, 'response'),
        sql`${sessionActivity.body} ? 'templateLabelSuggestion'`,
      ),
    )
    .limit(1);
  const input = LabelTemplateSuggestionRequest.safeParse(activity?.body['templateLabelSuggestion']);
  if (!input.success) return undefined;
  const [group] = await database
    .select({ teamId: labelGroup.teamId })
    .from(labelGroup)
    .where(
      and(eq(labelGroup.id, input.data.labelGroupId), eq(labelGroup.organizationId, caller.orgId)),
    );
  if (!group) return undefined;
  try {
    if (group.teamId) await requireTemplateTeam(caller, group.teamId, database);
  } catch (error) {
    if (error instanceof NotFoundError) return undefined;
    throw error;
  }
  const [selected] = await database
    .select({ id: label.id })
    .from(label)
    .where(
      and(
        eq(label.id, input.data.labelId),
        eq(label.organizationId, caller.orgId),
        eq(label.groupId, input.data.labelGroupId),
      ),
    );
  if (!selected) return undefined;
  return {
    labelGroupId: input.data.labelGroupId,
    labelId: selected.id,
    workTypeId: draft.id,
    workTypeVersionId: draft.latestPublishedVersionId,
  };
}
