import { db, organization, workTypeVersion } from '@docket/db';
import { WorkTemplateOut, WorkTemplateVersionOut } from '@docket/work/work-template-contract';
import { WorkTypeVersionId } from '@docket/work/ids';
import { and, eq } from 'drizzle-orm';
import { ENTITY_DISPLAY_SUBJECTS } from '@docket/work/entity-display-contract';
import { resolveVocabularyTerm } from '@docket/work/vocabulary';
import { mayAuthorTemplates, type TemplateActor } from './authorization';
import { draftOf, type TemplateRow, type TemplateVersionRow } from './model';
import { offeringsFor } from './persistence';
import { templateCopyPendingSelection } from './copy-reference-integrity';

function copyOrigin(row: TemplateRow) {
  return row.originWorkTypeId && row.originWorkTypeVersionId
    ? { workTypeId: row.originWorkTypeId, workTypeVersionId: row.originWorkTypeVersionId }
    : null;
}

/** Validate an immutable publication at the public boundary. */
export function toWorkTemplateVersion(row: TemplateVersionRow): WorkTemplateVersionOut {
  return WorkTemplateVersionOut.parse({ ...row, publishedAt: row.publishedAt.toISOString() });
}

/** Expose only a visible unpublished identity; ordinary drafts and real versions need no reservation metadata. */
async function pendingSelectionProjection(
  actor: TemplateActor,
  row: TemplateRow,
): Promise<Pick<WorkTemplateOut, 'pendingPublication'>> {
  if (row.latestPublishedVersionId || row.isBase) return {};
  const pendingPublication = await db.transaction((tx) =>
    templateCopyPendingSelection(tx, actor, row.id),
  );
  return pendingPublication
    ? {
        pendingPublication: {
          reservedFirstVersionId: WorkTypeVersionId.parse(
            pendingPublication.reservedFirstVersionId,
          ),
        },
      }
    : {};
}

/** Project a visible definition, withholding its editable draft from publication-only readers. */
export async function toWorkTemplateOut(
  actor: TemplateActor,
  row: TemplateRow,
): Promise<WorkTemplateOut> {
  const canEdit = row.publicationState !== 'archived' && (await mayAuthorTemplates(actor));
  const [version] = row.latestPublishedVersionId
    ? await db
        .select()
        .from(workTypeVersion)
        .where(
          and(
            eq(workTypeVersion.organizationId, actor.orgId),
            eq(workTypeVersion.workTypeId, row.id),
            eq(workTypeVersion.id, row.latestPublishedVersionId),
          ),
        )
        .limit(1)
    : [];
  const latestVersion = version ? toWorkTemplateVersion(version) : null;
  const offerings = await offeringsFor(actor.orgId, [row.id]);
  const [workspace] = row.isBase
    ? await db
        .select({ vocabulary: organization.vocabulary })
        .from(organization)
        .where(eq(organization.id, actor.orgId))
        .limit(1)
    : [];
  const baseDisplay = row.isBase
    ? {
        name: `Blank ${resolveVocabularyTerm(workspace?.vocabulary, row.targetType).singular.toLocaleLowerCase()}`,
        icon: ENTITY_DISPLAY_SUBJECTS[row.targetType].glyph,
      }
    : {};

  return WorkTemplateOut.parse({
    id: row.id,
    organizationId: row.organizationId,
    targetType: row.targetType,
    status: row.publicationState,
    scope: row.scope,
    ownerActorId: row.ownerActorId,
    teamId: row.teamId,
    isBase: row.isBase,
    origin: copyOrigin(row),
    revision: row.draftRevision,
    definition: { ...(latestVersion?.definition ?? draftOf(row)), ...baseDisplay },
    ...(canEdit ? { draftDefinition: { ...draftOf(row), ...baseDisplay } } : {}),
    offeredTeamIds: offerings.get(row.id) ?? [],
    latestVersion,
    ...(await pendingSelectionProjection(actor, row)),
    canEdit,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
