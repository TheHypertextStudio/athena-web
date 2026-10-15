import { db, organization, template, workTypeTeam, workTypeVersion } from '@docket/db';
import { ENTITY_DISPLAY_SUBJECTS } from '@docket/work/entity-display-contract';
import type { TemplateTargetType } from '@docket/work/template-contract';
import { resolveVocabularyTerm } from '@docket/work/vocabulary';
import { WorkTemplateChoice, WorkTemplateDisplay } from '@docket/work/work-template-reference';
import { and, asc, eq, exists, gt, inArray, isNull, notExists, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { NotFoundError } from '../error';
import type { Page } from '../contracts/pagination';
import { decodeIdCursor, encodeIdCursor } from './list-cursor';

const latest = alias(workTypeVersion, 'identity_latest_version');
const displayColumns = {
  id: template.id,
  kind: template.targetType,
  isBase: template.isBase,
  archivedAt: template.archivedAt,
  name: sql<string>`${workTypeVersion.definition}->>'name'`,
  icon: sql<unknown>`${workTypeVersion.definition}->'icon'`,
  versionId: workTypeVersion.id,
  versionNumber: workTypeVersion.number,
  latestVersionNumber: latest.number,
  vocabulary: organization.vocabulary,
};

function displayOf(row: {
  id: string;
  kind: TemplateTargetType;
  isBase: boolean;
  archivedAt: Date | null;
  name: string;
  icon: unknown;
  versionNumber: number;
  latestVersionNumber: number;
  vocabulary: (typeof organization.$inferSelect)['vocabulary'];
}): WorkTemplateDisplay {
  return WorkTemplateDisplay.parse({
    id: row.id,
    name: row.isBase
      ? `Blank ${resolveVocabularyTerm(row.vocabulary, row.kind).singular.toLocaleLowerCase()}`
      : row.name,
    icon: row.isBase ? ENTITY_DISPLAY_SUBJECTS[row.kind].glyph : row.icon,
    isBase: row.isBase,
    archived: row.archivedAt !== null,
    versionNumber: row.versionNumber,
    latestVersionNumber: row.latestVersionNumber,
  });
}

function publishedDisplayQuery() {
  return db
    .select(displayColumns)
    .from(template)
    .innerJoin(
      workTypeVersion,
      and(
        eq(workTypeVersion.workTypeId, template.id),
        eq(workTypeVersion.organizationId, template.organizationId),
      ),
    )
    .innerJoin(
      latest,
      and(
        eq(latest.id, template.latestPublishedVersionId),
        eq(latest.workTypeId, template.id),
        eq(latest.organizationId, template.organizationId),
      ),
    )
    .innerJoin(organization, eq(organization.id, template.organizationId))
    .$dynamic();
}

/**
 * Return one pinned publication's identity without resolving an editable draft or starting body.
 * Published archived templates remain readable for existing work, independent of team offerings.
 * @throws {NotFoundError} For a foreign, unpublished or mismatched definition/version pair.
 */
export async function getWorkTemplateDisplay(
  orgId: string,
  id: string,
  versionId: string,
): Promise<WorkTemplateDisplay> {
  const [row] = await publishedDisplayQuery()
    .where(
      and(
        eq(template.organizationId, orgId),
        eq(template.id, id),
        eq(template.scope, 'organization'),
        inArray(template.publicationState, ['published', 'archived']),
        eq(workTypeVersion.id, versionId),
      ),
    )
    .limit(1);
  if (!row) throw new NotFoundError('Template version not found');
  return displayOf(row);
}

/** Discover bounded published choices offered for the destination team, without draft/body data. */
export async function listWorkTemplateChoices(
  orgId: string,
  kind: TemplateTargetType,
  teamId?: string,
  options: { readonly limit: number; readonly cursor?: string | undefined } = { limit: 50 },
): Promise<Page<WorkTemplateChoice>> {
  const cursor = decodeIdCursor(options.cursor);
  const anyOffering = db
    .select({ teamId: workTypeTeam.teamId })
    .from(workTypeTeam)
    .where(and(eq(workTypeTeam.organizationId, orgId), eq(workTypeTeam.workTypeId, template.id)));
  const matchingOffering =
    teamId === undefined
      ? undefined
      : db
          .select({ teamId: workTypeTeam.teamId })
          .from(workTypeTeam)
          .where(
            and(
              eq(workTypeTeam.organizationId, orgId),
              eq(workTypeTeam.workTypeId, template.id),
              eq(workTypeTeam.teamId, teamId),
            ),
          );
  const offered = matchingOffering
    ? or(notExists(anyOffering), exists(matchingOffering))
    : notExists(anyOffering);
  const rows = await publishedDisplayQuery()
    .where(
      and(
        eq(template.organizationId, orgId),
        eq(template.targetType, kind),
        eq(template.scope, 'organization'),
        eq(template.publicationState, 'published'),
        isNull(template.archivedAt),
        eq(workTypeVersion.id, template.latestPublishedVersionId),
        offered,
        cursor ? gt(template.id, cursor) : undefined,
      ),
    )
    .orderBy(asc(template.id))
    .limit(options.limit + 1);
  const items = rows
    .slice(0, options.limit)
    .map((row) => WorkTemplateChoice.parse({ ...displayOf(row), versionId: row.versionId }));
  const last = items.at(-1);
  return {
    items,
    ...(rows.length > options.limit && last ? { nextCursor: encodeIdCursor(last.id) } : {}),
  };
}
