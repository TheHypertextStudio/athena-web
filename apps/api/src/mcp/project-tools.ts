import { db, project } from '@docket/db';
import { ProjectRef, ProjectStatus } from '@docket/types';
import type { McpRegistrar } from './catalog';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { NotFoundError } from '../error';
import { clearableTextPatch } from '../lib/clearable-text';
import { enqueueSearchUpsert } from '../search/write-through';
import type { McpContext } from './auth';
import { jsonResult, runTool, scopedActor, authorize } from './result';
import { DESCRIPTOR_HINT, resolveOptional } from './descriptors';
import { orgIdParam } from './tools-shared';

/** Register create_project and update_project on `server`. */
export function registerProjectTools(server: McpRegistrar, ctx: McpContext): void {
  server.registerTool(
    'create_project',
    {
      title: 'Create project',
      description:
        'Create a project — a bounded effort that moves planned → active → completed. For ongoing work that never finishes, create a program instead.',
      inputSchema: {
        orgId: orgIdParam,
        name: z.string().min(1).describe('What the project is called.'),
        description: z.string().optional().describe('The full brief, as markdown.'),
        leadId: z.string().optional().describe(`Who leads it. ${DESCRIPTOR_HINT}`),
        teamId: z.string().optional().describe(`The team that owns it. ${DESCRIPTOR_HINT}`),
        startDate: z.iso.date().optional().describe('When work starts, as `YYYY-MM-DD`.'),
        targetDate: z.iso.date().optional().describe('The target finish, as `YYYY-MM-DD`.'),
      },
      outputSchema: ProjectRef.pick({ id: true, name: true }).shape,
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

        const [leadId, teamId] = await Promise.all([
          resolveOptional(input.orgId, 'actor', input.leadId, 'leadId'),
          resolveOptional(input.orgId, 'team', input.teamId, 'teamId'),
        ]);

        const inserted = await db
          .insert(project)
          .values({
            organizationId: input.orgId,
            name: input.name,
            description: input.description,
            leadId,
            teamId,
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
      description:
        'Update a project. Only the fields you pass change; pass null to a nullable one to clear it.',
      inputSchema: {
        orgId: orgIdParam,
        projectId: z.string().min(1).describe(`The project to update. ${DESCRIPTOR_HINT}`),
        name: z.string().min(1).optional().describe('What the project is called.'),
        description: z.string().optional().describe('The full brief, as markdown.'),
        status: ProjectStatus.optional(),
        leadId: z
          .string()
          .nullable()
          .optional()
          .describe(`Who leads it, or null to clear. ${DESCRIPTOR_HINT}`),
        programId: z
          .string()
          .nullable()
          .optional()
          .describe(`The program it rolls up to, or null to detach. ${DESCRIPTOR_HINT}`),
        startDate: z.iso.date().nullable().optional().describe('When work starts, or null.'),
        targetDate: z.iso.date().nullable().optional().describe('The target finish, or null.'),
      },
      outputSchema: ProjectRef.pick({ id: true, name: true, status: true }).shape,
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
        // These parameters advertise DESCRIPTOR_HINT, so they must actually resolve names —
        // `assertRefInOrg` only ever accepted a raw id, making the description a lie.
        const [leadId, programId] = await Promise.all([
          resolveOptional(input.orgId, 'actor', input.leadId, 'leadId'),
          resolveOptional(input.orgId, 'program', input.programId, 'programId'),
        ]);

        const patch = {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...clearableTextPatch('description', input.description),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(leadId !== undefined ? { leadId } : {}),
          ...(programId !== undefined ? { programId } : {}),
          ...(input.startDate !== undefined
            ? { startDate: input.startDate ? new Date(input.startDate) : null }
            : {}),
          ...(input.targetDate !== undefined
            ? { targetDate: input.targetDate ? new Date(input.targetDate) : null }
            : {}),
        };
        if (Object.keys(patch).length === 0) {
          // Same shape as the update branch: a caller should not have to notice that its patch
          // happened to be empty, and the declared output schema is one contract, not two.
          const rows = await db
            .select({ id: project.id, name: project.name, status: project.status })
            .from(project)
            .where(and(eq(project.id, input.projectId), eq(project.organizationId, input.orgId)))
            .limit(1);
          const current = rows[0];
          if (!current) throw new NotFoundError('Project not found');
          return jsonResult({ id: current.id, name: current.name, status: current.status });
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
