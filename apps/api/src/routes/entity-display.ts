/** Workspace-scoped presentation metadata for supported work entities. */
import { db, entityDisplay, initiative, project } from '@docket/db';
import {
  defaultEntityDisplay,
  EntityDisplayOut,
  EntityDisplaySubjectType,
  EntityDisplayUpdate,
} from '@docket/types';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { capabilityGuard } from '../permissions/capability-guard';
import { zJson, zParam } from '../lib/validate';

const displayParam = z.object({
  subjectType: EntityDisplaySubjectType,
  subjectId: z.string(),
});

async function assertSubjectInWorkspace(
  organizationId: string,
  subjectType: EntityDisplaySubjectType,
  subjectId: string,
): Promise<void> {
  const rows =
    subjectType === 'initiative'
      ? await db
          .select({ id: initiative.id })
          .from(initiative)
          .where(and(eq(initiative.id, subjectId), eq(initiative.organizationId, organizationId)))
          .limit(1)
      : await db
          .select({ id: project.id })
          .from(project)
          .where(and(eq(project.id, subjectId), eq(project.organizationId, organizationId)))
          .limit(1);
  if (!rows[0]) throw new NotFoundError('Work item not found');
}

/** Generic entity-display router mounted at `/v1/orgs/:orgId/display`. */
const entityDisplayRouter = new Hono<AppEnv>()
  .get(
    '/:subjectType/:subjectId',
    apiDoc({
      tag: 'Display',
      summary: 'Get work-item display metadata',
      description:
        'Returns decoupled icon and semantic color metadata for an Initiative or Project, falling back to stable defaults when the work item has not been customized.',
      response: EntityDisplayOut,
    }),
    zParam(displayParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { subjectType, subjectId } = c.req.valid('param');
      await assertSubjectInWorkspace(orgId, subjectType, subjectId);
      const [row] = await db
        .select()
        .from(entityDisplay)
        .where(
          and(
            eq(entityDisplay.organizationId, orgId),
            eq(entityDisplay.subjectType, subjectType),
            eq(entityDisplay.subjectId, subjectId),
          ),
        )
        .limit(1);
      return ok(
        c,
        EntityDisplayOut,
        row
          ? {
              subjectType,
              subjectId,
              iconKey: row.iconKey,
              colorKey: row.colorKey,
              customColor: row.customColor,
              customized: true,
            }
          : defaultEntityDisplay(subjectType, subjectId),
      );
    },
  )
  .put(
    '/:subjectType/:subjectId',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Display',
      summary: 'Customize work-item display metadata',
      description:
        'Creates or replaces decoupled icon and semantic color metadata for an Initiative or Project without changing the work item domain record itself.',
      capability: 'contribute',
      response: EntityDisplayOut,
    }),
    zParam(displayParam),
    zJson(EntityDisplayUpdate),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { subjectType, subjectId } = c.req.valid('param');
      const body = c.req.valid('json');
      await assertSubjectInWorkspace(orgId, subjectType, subjectId);
      const [row] = await db
        .insert(entityDisplay)
        .values({
          organizationId: orgId,
          subjectType,
          subjectId,
          iconKey: body.iconKey,
          colorKey: body.colorKey,
          customColor: body.customColor,
          createdBy: actorId,
        })
        .onConflictDoUpdate({
          target: [
            entityDisplay.organizationId,
            entityDisplay.subjectType,
            entityDisplay.subjectId,
          ],
          set: {
            iconKey: body.iconKey,
            colorKey: body.colorKey,
            customColor: body.customColor,
            updatedAt: new Date(),
          },
        })
        .returning();
      /* v8 ignore next -- @preserve insert/upsert always returns one row */
      if (!row) throw new Error('entity display upsert returned no row');
      return ok(c, EntityDisplayOut, {
        subjectType,
        subjectId,
        iconKey: row.iconKey,
        colorKey: row.colorKey,
        customColor: row.customColor,
        customized: true,
      });
    },
  )
  .delete(
    '/:subjectType/:subjectId',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Display',
      summary: 'Reset work-item display metadata',
      description:
        'Deletes customized icon and semantic color metadata for an Initiative or Project and returns the stable default presentation for that work item type.',
      capability: 'contribute',
      response: EntityDisplayOut,
    }),
    zParam(displayParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { subjectType, subjectId } = c.req.valid('param');
      await assertSubjectInWorkspace(orgId, subjectType, subjectId);
      await db
        .delete(entityDisplay)
        .where(
          and(
            eq(entityDisplay.organizationId, orgId),
            eq(entityDisplay.subjectType, subjectType),
            eq(entityDisplay.subjectId, subjectId),
          ),
        );
      return ok(c, EntityDisplayOut, defaultEntityDisplay(subjectType, subjectId));
    },
  );

export default entityDisplayRouter;
