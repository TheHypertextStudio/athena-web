/**
 * Typed work-view operations mounted at `/v1/orgs/:orgId/work-views`.
 */
import { db, hub, organizationWorkViewDefault } from '@docket/db';
import {
  OrganizationWorkViewDefault,
  OrganizationWorkViewDefaultBody,
  OrganizationWorkViewDefaultWrite,
  WorkViewFacetRequest,
  WorkViewFacetResponse,
  WorkViewOrderRequest,
  WorkViewOrderResponse,
  WorkViewQueryRequest,
  WorkViewQueryResponse,
} from '@docket/types';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import type { JsonRoute } from '../lib/hono-rpc';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam } from '../lib/validate';
import { queryWorkViewFacets } from '../lib/work-views/facets';
import { reorderWorkView } from '../lib/work-views/order';
import { queryWorkView } from '../lib/work-views/query';
import { capabilityGuard } from '../permissions/capability-guard';

const defaultTargetParam = z.object({
  target: z.enum(['task', 'project', 'program', 'initiative']),
});

type OrganizationWorkViewDefaultInput = z.input<typeof OrganizationWorkViewDefault>;
type DefaultDefinitionFor<TTarget extends OrganizationWorkViewDefaultInput['target']> = Extract<
  OrganizationWorkViewDefaultInput,
  { target: TTarget }
>['definition'];

/**
 * Correlate a stored default's target and definition for the response serializer.
 *
 * The database check constrains `target`, but Drizzle cannot express the matching JSON union.
 * These branch-local assertions restore that correlation only to TypeScript. The caller must
 * still pass the result through `ok`, which owns runtime output validation and error mapping.
 */
function organizationDefaultOut(
  row: typeof organizationWorkViewDefault.$inferSelect,
): OrganizationWorkViewDefaultInput {
  const timestamps = {
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt.toISOString(),
  };
  switch (row.target) {
    case 'task':
      return {
        ...timestamps,
        target: 'task',
        definition: row.definition as DefaultDefinitionFor<'task'>,
      };
    case 'project':
      return {
        ...timestamps,
        target: 'project',
        definition: row.definition as DefaultDefinitionFor<'project'>,
      };
    case 'program':
      return {
        ...timestamps,
        target: 'program',
        definition: row.definition as DefaultDefinitionFor<'program'>,
      };
    case 'initiative':
      return {
        ...timestamps,
        target: 'initiative',
        definition: row.definition as DefaultDefinitionFor<'initiative'>,
      };
  }
}

/** Named RPC schema for organization-scoped work-view execution and defaults. */
export type WorkViewRoutes = JsonRoute<
  'post',
  '/query',
  { json: z.input<typeof WorkViewQueryRequest> },
  { json: z.output<typeof WorkViewQueryRequest> },
  WorkViewQueryResponse
> &
  JsonRoute<
    'post',
    '/facets',
    { json: z.input<typeof WorkViewFacetRequest> },
    { json: z.output<typeof WorkViewFacetRequest> },
    WorkViewFacetResponse
  > &
  JsonRoute<
    'patch',
    '/order',
    { json: z.input<typeof WorkViewOrderRequest> },
    { json: z.output<typeof WorkViewOrderRequest> },
    WorkViewOrderResponse
  > &
  JsonRoute<
    'get',
    '/defaults/:target',
    { param: z.input<typeof defaultTargetParam> },
    { param: z.output<typeof defaultTargetParam> },
    OrganizationWorkViewDefault
  > &
  JsonRoute<
    'patch',
    '/defaults/:target',
    {
      param: z.input<typeof defaultTargetParam>;
      json: z.input<typeof OrganizationWorkViewDefaultBody>;
    },
    {
      param: z.output<typeof defaultTargetParam>;
      json: z.output<typeof OrganizationWorkViewDefaultBody>;
    },
    OrganizationWorkViewDefault
  >;

async function sessionTimeZone(userId: string | undefined): Promise<string> {
  if (!userId) return 'UTC';
  const rows = await db
    .select({ preferences: hub.preferences })
    .from(hub)
    .where(eq(hub.userId, userId))
    .limit(1);
  const timeZone = rows[0]?.preferences.timezone ?? 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format();
    return timeZone;
  } catch {
    return 'UTC';
  }
}

/** Organization-scoped routes for executing typed work views. */
const workViews: Hono<AppEnv, WorkViewRoutes> = new Hono<AppEnv>()
  .post(
    '/query',
    apiDoc({
      tag: 'Views',
      summary: 'Query a typed work view',
      response: WorkViewQueryResponse,
      description:
        'Execute one bounded, permission-scoped Task, Project, Program, or Initiative view.',
    }),
    zJson(WorkViewQueryRequest),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const timeZone = await sessionTimeZone(c.get('session')?.user.id);
      const result = await queryWorkView({
        database: db,
        organizationId: orgId,
        actorId,
        request: c.req.valid('json'),
        timeZone,
      });
      return ok(c, WorkViewQueryResponse, result);
    },
  )
  .post(
    '/facets',
    apiDoc({
      tag: 'Views',
      summary: 'Read active work-view facets',
      response: WorkViewFacetResponse,
      description:
        'Return bounded target-specific options after authorization, context, and active filters.',
    }),
    zJson(WorkViewFacetRequest),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const timeZone = await sessionTimeZone(c.get('session')?.user.id);
      const result = await queryWorkViewFacets({
        database: db,
        organizationId: orgId,
        actorId,
        request: c.req.valid('json'),
        timeZone,
      });
      return ok(c, WorkViewFacetResponse, result);
    },
  )
  .patch(
    '/order',
    apiDoc({
      tag: 'Views',
      summary: 'Reorder a work-view item',
      capability: 'contribute',
      response: WorkViewOrderResponse,
      description:
        'Persist contextual manual order and apply a validated mutable group property change.',
    }),
    zJson(WorkViewOrderRequest),
    async (c) => {
      const { orgId, actorId, capabilities } = c.get('actorCtx');
      const result = await reorderWorkView({
        database: db,
        organizationId: orgId,
        actorId,
        capabilities,
        request: c.req.valid('json'),
      });
      return ok(c, WorkViewOrderResponse, result);
    },
  )
  .get(
    '/defaults/:target',
    apiDoc({
      tag: 'Views',
      summary: 'Read an organization work-view default',
      response: OrganizationWorkViewDefault,
      description: 'Read the workspace-owned default definition for one planning target.',
    }),
    zParam(defaultTargetParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { target } = c.req.valid('param');
      const rows = await db
        .select()
        .from(organizationWorkViewDefault)
        .where(
          and(
            eq(organizationWorkViewDefault.organizationId, orgId),
            eq(organizationWorkViewDefault.target, target),
          ),
        )
        .limit(1);
      const row = rows[0];
      if (!row) throw new NotFoundError('Work-view default not found');
      return ok(c, OrganizationWorkViewDefault, organizationDefaultOut(row));
    },
  )
  .patch(
    '/defaults/:target',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Views',
      summary: 'Update an organization work-view default',
      capability: 'manage',
      response: OrganizationWorkViewDefault,
      description: 'Set the workspace-owned default definition for one planning target.',
    }),
    zParam(defaultTargetParam),
    zJson(OrganizationWorkViewDefaultBody),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { target } = c.req.valid('param');
      const body = OrganizationWorkViewDefaultWrite.parse({
        target,
        definition: c.req.valid('json').definition,
      });
      const rows = await db
        .insert(organizationWorkViewDefault)
        .values({
          organizationId: orgId,
          target: body.target,
          definition: body.definition,
          updatedBy: actorId,
        })
        .onConflictDoUpdate({
          target: [organizationWorkViewDefault.organizationId, organizationWorkViewDefault.target],
          set: { definition: body.definition, updatedBy: actorId, updatedAt: new Date() },
        })
        .returning();
      const row = rows[0];
      if (!row) throw new TypeError('A work-view default update returned no row.');
      return ok(c, OrganizationWorkViewDefault, organizationDefaultOut(row));
    },
  );

export default workViews;
