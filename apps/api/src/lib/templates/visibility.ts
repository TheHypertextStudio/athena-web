import { db, teamMember, template } from '@docket/db';
import type { TemplateTargetType } from '@docket/work/template-contract';
import { and, eq, exists, isNotNull, ne, or, sql, type SQL } from 'drizzle-orm';

/** Select visible definitions before reading their draft names, bodies, or pagination keys. */
export function visibleTemplateWhere(
  orgId: string,
  actorId: string,
  filters: {
    readonly id?: string | undefined;
    readonly targetType?: TemplateTargetType | undefined;
    readonly includeArchived?: boolean;
    readonly includeBase?: boolean;
  },
): SQL | undefined {
  return and(
    eq(template.organizationId, orgId),
    filters.id === undefined ? undefined : eq(template.id, filters.id),
    filters.targetType === undefined ? undefined : eq(template.targetType, filters.targetType),
    filters.includeArchived ? undefined : ne(template.publicationState, 'archived'),
    filters.includeBase ? undefined : eq(template.isBase, false),
    or(
      and(
        eq(template.scope, 'organization'),
        or(isNotNull(template.latestPublishedVersionId), eq(template.ownerActorId, actorId)),
      ),
      and(eq(template.scope, 'personal'), eq(template.ownerActorId, actorId)),
      and(
        eq(template.scope, 'team'),
        exists(
          db
            .select({ one: sql`1` })
            .from(teamMember)
            .where(
              and(
                eq(teamMember.organizationId, orgId),
                eq(teamMember.actorId, actorId),
                eq(teamMember.teamId, template.teamId),
              ),
            ),
        ),
      ),
    ),
  );
}
