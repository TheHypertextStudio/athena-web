import { actor, db, program, project } from '@docket/db';
import type { McpRegistrar } from './catalog';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { NotFoundError } from '../error';
import { enqueueSearchUpsert } from '../search/write-through';
import type { McpContext } from './auth';
import { jsonResult, runTool, scopedActor, authorize } from './result';
import { assertRefInOrg } from './tools-shared';

/** Register create_project and update_project on `server`. */
export function registerProjectTools(server: McpRegistrar, ctx: McpContext): void {
  server.registerTool(
    'create_project',
    {
      title: 'Create project',
      description: 'Create a project within an organization.',
      inputSchema: {
        orgId: z.string().min(1),
        name: z.string().min(1),
        description: z.string().optional(),
        leadId: z.string().optional(),
        teamId: z.string().optional(),
        startDate: z.iso.date().optional(),
        targetDate: z.iso.date().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    (input) =>
      runTool(async () => {
        const actorCtx = await scopedActor(ctx, input.orgId, 'work:write');
        await authorize(actorCtx, 'contribute', {
          kind: 'organization',
          id: input.orgId,
          orgId: input.orgId,
        });

        const inserted = await db
          .insert(project)
          .values({
            organizationId: input.orgId,
            name: input.name,
            description: input.description,
            leadId: input.leadId,
            teamId: input.teamId,
            startDate: input.startDate ? new Date(input.startDate) : undefined,
            targetDate: input.targetDate ? new Date(input.targetDate) : undefined,
            createdBy: actorCtx.actorId,
          })
          .returning();
        const row = inserted[0];
        /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
        if (!row) throw new Error('project insert returned no row');
        await enqueueSearchUpsert(input.orgId, 'project', row.id);
        return jsonResult({ id: row.id, name: row.name });
      }),
  );

  server.registerTool(
    'update_project',
    {
      title: 'Update project',
      description: 'Partially update a project (name, description, status, lead, dates).',
      inputSchema: {
        orgId: z.string().min(1),
        projectId: z.string().min(1),
        name: z.string().min(1).optional(),
        description: z.string().nullable().optional(),
        status: z.enum(['planned', 'active', 'completed', 'canceled']).optional(),
        leadId: z.string().nullable().optional(),
        programId: z.string().nullable().optional(),
        startDate: z.iso.date().nullable().optional(),
        targetDate: z.iso.date().nullable().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) =>
      runTool(async () => {
        const actorCtx = await scopedActor(ctx, input.orgId, 'work:write');
        await authorize(actorCtx, 'contribute', {
          kind: 'project',
          id: input.projectId,
          orgId: input.orgId,
        });
        await assertRefInOrg(actor, input.orgId, input.leadId, 'Lead not found');
        await assertRefInOrg(program, input.orgId, input.programId, 'Program not found');

        const patch = {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.leadId !== undefined ? { leadId: input.leadId } : {}),
          ...(input.programId !== undefined ? { programId: input.programId } : {}),
          ...(input.startDate !== undefined
            ? { startDate: input.startDate ? new Date(input.startDate) : null }
            : {}),
          ...(input.targetDate !== undefined
            ? { targetDate: input.targetDate ? new Date(input.targetDate) : null }
            : {}),
        };
        if (Object.keys(patch).length === 0) {
          const rows = await db
            .select({ id: project.id, name: project.name })
            .from(project)
            .where(and(eq(project.id, input.projectId), eq(project.organizationId, input.orgId)))
            .limit(1);
          if (!rows[0]) throw new NotFoundError('Project not found');
          return jsonResult({ id: rows[0].id, name: rows[0].name });
        }
        const updated = await db
          .update(project)
          .set(patch)
          .where(and(eq(project.id, input.projectId), eq(project.organizationId, input.orgId)))
          .returning();
        const row = updated[0];
        if (!row) throw new NotFoundError('Project not found');
        await enqueueSearchUpsert(input.orgId, 'project', row.id);
        return jsonResult({ id: row.id, name: row.name, status: row.status });
      }),
  );
}
