/**
 * Project dependency routes, mounted under the Projects resource.
 *
 * @remarks
 * Edges are directed `blocking → blocked`, organization-scoped, and made acyclic in a
 * serializable transaction so concurrent inserts cannot create an invalid graph.
 */
import { db, project, projectDependency } from '@docket/db';
import {
  ProjectDependencyCreate,
  ProjectDependencyCreated,
  ProjectDependencyOut,
  ProjectDependencyRemoved,
} from '@docket/types';
import type { ProjectRef } from '@docket/types';
import { and, eq, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { ConflictError, CycleError, NotFoundError, ValidationError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { rawResultRowCount } from '../lib/raw-result';
import { serializableTx } from '../lib/serializable-tx';
import { zJson, zParam } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';

const idParam = z.object({ id: z.string() });
const depParam = z.object({ id: z.string(), depId: z.string() });
type ProjectRow = typeof project.$inferSelect;

async function loadProject(orgId: string, id: string): Promise<ProjectRow> {
  const rows = await db
    .select()
    .from(project)
    .where(and(eq(project.id, id), eq(project.organizationId, orgId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Project not found');
  return row;
}

function toRef(row: ProjectRow): z.input<typeof ProjectRef> {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    targetDate: row.targetDate?.toISOString() ?? null,
  };
}

async function wouldCreateCycle(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  orgId: string,
  blockingProjectId: string,
  blockedProjectId: string,
): Promise<boolean> {
  const reach = await tx.execute(sql`
    WITH RECURSIVE reach AS (
      SELECT blocked_project_id AS n FROM project_dependency
        WHERE blocking_project_id = ${blockedProjectId} AND organization_id = ${orgId}
      UNION
      SELECT d.blocked_project_id FROM project_dependency d
        JOIN reach r ON d.blocking_project_id = r.n WHERE d.organization_id = ${orgId}
    )
    SELECT 1 AS hit FROM reach WHERE n = ${blockingProjectId} LIMIT 1
  `);
  return rawResultRowCount(reach) > 0;
}

/** Routes for reading and mutating directed dependency edges between Projects. */
export const projectDependencyRoutes = new Hono<AppEnv>()
  .get(
    '/:id/dependencies',
    apiDoc({
      tag: 'Projects',
      summary: 'List project dependencies',
      description:
        'Lists both directions of the selected Project dependency graph: Projects this one blocks and Projects that must finish before this one can proceed.',
      response: ProjectDependencyOut,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      await loadProject(orgId, id);
      const [blocking, blockedBy] = await Promise.all([
        db
          .select()
          .from(projectDependency)
          .innerJoin(project, eq(projectDependency.blockedProjectId, project.id))
          .where(
            and(
              eq(projectDependency.organizationId, orgId),
              eq(projectDependency.blockingProjectId, id),
            ),
          ),
        db
          .select()
          .from(projectDependency)
          .innerJoin(project, eq(projectDependency.blockingProjectId, project.id))
          .where(
            and(
              eq(projectDependency.organizationId, orgId),
              eq(projectDependency.blockedProjectId, id),
            ),
          ),
      ]);
      return ok(c, ProjectDependencyOut, {
        blocking: blocking.map((row) => toRef(row.project)),
        blockedBy: blockedBy.map((row) => toRef(row.project)),
      });
    },
  )
  .post(
    '/:id/dependencies',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Projects',
      summary: 'Add a project dependency',
      description:
        'Creates a directed dependency between two Projects in the workspace after rejecting self-links, duplicate edges, inaccessible Projects, and cycles.',
      capability: 'contribute',
      response: ProjectDependencyCreated,
    }),
    zParam(idParam),
    zJson(ProjectDependencyCreate),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      const blockingProjectId = body.blockingProjectId ?? id;
      const blockedProjectId = body.blockedProjectId ?? id;
      const otherId = body.blockingProjectId ?? body.blockedProjectId;
      if (!otherId) throw new NotFoundError('Project not found');
      if (blockingProjectId === blockedProjectId) {
        throw new ValidationError(
          new z.ZodError([
            {
              code: 'custom',
              path: ['blockedProjectId'],
              message: 'A project cannot depend on itself',
              input: otherId,
            },
          ]),
        );
      }
      await loadProject(orgId, id);
      await loadProject(orgId, otherId);
      await serializableTx(async (tx) => {
        const existing = await tx
          .select({ blockingProjectId: projectDependency.blockingProjectId })
          .from(projectDependency)
          .where(
            and(
              eq(projectDependency.organizationId, orgId),
              eq(projectDependency.blockingProjectId, blockingProjectId),
              eq(projectDependency.blockedProjectId, blockedProjectId),
            ),
          )
          .limit(1);
        if (existing[0]) throw new ConflictError('Dependency edge already exists');
        if (await wouldCreateCycle(tx, orgId, blockingProjectId, blockedProjectId)) {
          throw new CycleError();
        }
        await tx.insert(projectDependency).values({
          organizationId: orgId,
          blockingProjectId,
          blockedProjectId,
        });
      });
      return ok(c, ProjectDependencyCreated, {
        created: true,
        blockingProjectId,
        blockedProjectId,
      });
    },
  )
  .delete(
    '/:id/dependencies/:depId',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Projects',
      summary: 'Remove a project dependency',
      description:
        'Removes the dependency edge connecting the selected Project and dependency Project, regardless of which direction is represented by the route parameters.',
      capability: 'contribute',
      response: ProjectDependencyRemoved,
    }),
    zParam(depParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id, depId } = c.req.valid('param');
      await loadProject(orgId, id);
      const removed = await db
        .delete(projectDependency)
        .where(
          and(
            eq(projectDependency.organizationId, orgId),
            or(
              and(
                eq(projectDependency.blockingProjectId, id),
                eq(projectDependency.blockedProjectId, depId),
              ),
              and(
                eq(projectDependency.blockingProjectId, depId),
                eq(projectDependency.blockedProjectId, id),
              ),
            ),
          ),
        )
        .returning({ blockingProjectId: projectDependency.blockingProjectId });
      if (!removed[0]) throw new NotFoundError('Project dependency not found');
      return ok(c, ProjectDependencyRemoved, { removed: true });
    },
  );
