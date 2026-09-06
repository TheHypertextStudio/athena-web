/**
 * `@docket/api` — which templates one actor may see.
 *
 * @remarks
 * Shared by the templates router and the planning canvas, which offers Athena the same list a
 * composer's picker shows: organization templates, the actor's own personal templates, and the
 * templates of teams the actor belongs to. Nothing else is ever returned, so a personal payload
 * never reaches another member and a team payload never reaches a nonmember.
 */
import { db, teamMember, template } from '@docket/db';
import type { TemplateTargetType } from '@docket/work/template-contract';
import { and, eq, exists, or, sql } from 'drizzle-orm';

/** The `where` clause selecting the templates `actorId` may see in `orgId`. */
export function visibleTemplateWhere(
  orgId: string,
  actorId: string,
  filters: {
    readonly id?: string | undefined;
    readonly targetType?: TemplateTargetType | undefined;
  },
) {
  return and(
    eq(template.organizationId, orgId),
    filters.id === undefined ? undefined : eq(template.id, filters.id),
    filters.targetType === undefined ? undefined : eq(template.targetType, filters.targetType),
    or(
      eq(template.scope, 'organization'),
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
