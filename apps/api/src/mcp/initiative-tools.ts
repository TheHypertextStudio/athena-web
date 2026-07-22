import {
  actor,
  db,
  initiative,
  initiativeProgram,
  initiativeProject,
  program,
  project,
} from '@docket/db';
import type { McpRegistrar } from './catalog';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { NotFoundError } from '../error';
import { clearableTextPatch } from '../lib/clearable-text';
import { emitEvent } from '../routes/event-emit';
import { enqueueSearchUpsert } from '../search/write-through';
import type { McpContext } from './auth';
import { jsonResult, runTool, scopedActor, authorize } from './result';
import { assertRefInOrg } from './tools-shared';

/** Register Initiative and Program mutation tools on `server`. */
export function registerInitiativeTools(server: McpRegistrar, ctx: McpContext): void {
  server.registerTool(
    'create_program',
    {
      title: 'Create program',
      description:
        'Create an ongoing program (status active/paused/archived; programs never complete).',
      inputSchema: {
        orgId: z.string().min(1),
        name: z.string().min(1),
        description: z.string().optional(),
        ownerId: z.string().optional(),
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
        // The programs router gates create on `manage`; mirror that bar exactly.
        const actorCtx = await scopedActor(ctx, input.orgId, 'work:write');
        await authorize(actorCtx, 'manage', {
          kind: 'organization',
          id: input.orgId,
          orgId: input.orgId,
        });
        await assertRefInOrg(actor, input.orgId, input.ownerId, 'Owner not found');

        const inserted = await db
          .insert(program)
          .values({
            organizationId: input.orgId,
            name: input.name,
            description: input.description,
            ownerId: input.ownerId,
            status: 'active',
            createdBy: actorCtx.actorId,
          })
          .returning();
        const row = inserted[0];
        /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
        if (!row) throw new Error('program insert returned no row');
        await enqueueSearchUpsert(input.orgId, 'program', row.id);
        return jsonResult({ id: row.id, name: row.name });
      }),
  );

  server.registerTool(
    'create_initiative',
    {
      title: 'Create initiative',
      description:
        'Create a cross-cutting theme (associates with programs/projects; holds no work).',
      inputSchema: {
        orgId: z.string().min(1),
        name: z.string().min(1),
        summary: z.string().max(280).optional(),
        description: z.string().optional(),
        ownerId: z.string().optional(),
        status: z.enum(['proposed', 'active', 'completed', 'canceled']).default('active'),
        health: z.enum(['on_track', 'at_risk', 'off_track']).optional(),
        priority: z.enum(['none', 'low', 'medium', 'high']).default('none'),
        updateCadence: z
          .enum(['weekly', 'biweekly', 'monthly', 'quarterly', 'none'])
          .default('monthly'),
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
        await assertRefInOrg(actor, input.orgId, input.ownerId, 'Owner not found');

        const inserted = await db
          .insert(initiative)
          .values({
            organizationId: input.orgId,
            name: input.name,
            summary: input.summary,
            description: input.description,
            ownerId: input.ownerId,
            status: input.status,
            health: input.health,
            priority: input.priority,
            updateCadence: input.updateCadence,
            targetDate: input.targetDate ? new Date(input.targetDate) : undefined,
            createdBy: actorCtx.actorId,
          })
          .returning();
        const row = inserted[0];
        /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
        if (!row) throw new Error('initiative insert returned no row');
        await enqueueSearchUpsert(input.orgId, 'initiative', row.id);
        return jsonResult({
          id: row.id,
          name: row.name,
          summary: row.summary,
          status: row.status,
          health: row.health,
          priority: row.priority,
          updateCadence: row.updateCadence,
          targetDate: row.targetDate?.toISOString() ?? null,
        });
      }),
  );

  server.registerTool(
    'update_initiative',
    {
      title: 'Update initiative',
      description: 'Update an Initiative document or its independently owned strategic state.',
      inputSchema: {
        orgId: z.string().min(1),
        initiativeId: z.string().min(1),
        name: z.string().min(1).optional(),
        summary: z.string().max(280).optional(),
        description: z.string().optional(),
        ownerId: z.string().nullable().optional(),
        status: z.enum(['proposed', 'active', 'completed', 'canceled']).optional(),
        health: z.enum(['on_track', 'at_risk', 'off_track']).nullable().optional(),
        priority: z.enum(['none', 'low', 'medium', 'high']).optional(),
        updateCadence: z.enum(['weekly', 'biweekly', 'monthly', 'quarterly', 'none']).optional(),
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
          kind: 'initiative',
          id: input.initiativeId,
          orgId: input.orgId,
        });
        await assertRefInOrg(actor, input.orgId, input.ownerId ?? undefined, 'Owner not found');
        const patch: Partial<typeof initiative.$inferInsert> = {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...clearableTextPatch('summary', input.summary),
          ...clearableTextPatch('description', input.description),
          ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.health !== undefined ? { health: input.health } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.updateCadence !== undefined ? { updateCadence: input.updateCadence } : {}),
          ...(input.targetDate !== undefined
            ? { targetDate: input.targetDate ? new Date(input.targetDate) : null }
            : {}),
        };
        const rows =
          Object.keys(patch).length === 0
            ? await db
                .select()
                .from(initiative)
                .where(
                  and(
                    eq(initiative.id, input.initiativeId),
                    eq(initiative.organizationId, input.orgId),
                  ),
                )
                .limit(1)
            : await db
                .update(initiative)
                .set(patch)
                .where(
                  and(
                    eq(initiative.id, input.initiativeId),
                    eq(initiative.organizationId, input.orgId),
                  ),
                )
                .returning();
        const row = rows[0];
        if (!row) throw new NotFoundError('Initiative not found');
        if (input.health !== undefined || input.status !== undefined) {
          await emitEvent({
            organizationId: input.orgId,
            kind: 'status_change',
            actorId: actorCtx.actorId,
            title: row.name,
            subject: { type: 'initiative', id: row.id, title: row.name },
            detail: {
              schema: 'docket.state_change',
              fromState: null,
              toState: input.health ?? input.status ?? 'unset',
            },
          });
        }
        await enqueueSearchUpsert(input.orgId, 'initiative', row.id);
        return jsonResult({
          id: row.id,
          name: row.name,
          summary: row.summary,
          status: row.status,
          health: row.health,
          priority: row.priority,
          updateCadence: row.updateCadence,
          targetDate: row.targetDate?.toISOString() ?? null,
        });
      }),
  );

  server.registerTool(
    'link_initiative',
    {
      title: 'Link initiative',
      description: 'Link or unlink an initiative to/from a project or program (m2m theme link).',
      inputSchema: {
        orgId: z.string().min(1),
        initiativeId: z.string().min(1),
        targetType: z.enum(['project', 'program']),
        targetId: z.string().min(1),
        action: z.enum(['link', 'unlink']).default('link'),
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
        // The initiatives router gates link/unlink on `contribute`.
        const actorCtx = await scopedActor(ctx, input.orgId, 'work:write');
        await authorize(actorCtx, 'contribute', {
          kind: 'initiative',
          id: input.initiativeId,
          orgId: input.orgId,
        });

        const initRows = await db
          .select({ id: initiative.id })
          .from(initiative)
          .where(
            and(eq(initiative.id, input.initiativeId), eq(initiative.organizationId, input.orgId)),
          )
          .limit(1);
        if (!initRows[0]) throw new NotFoundError('Initiative not found');

        if (input.targetType === 'project') {
          const proj = await db
            .select({ id: project.id })
            .from(project)
            .where(and(eq(project.id, input.targetId), eq(project.organizationId, input.orgId)))
            .limit(1);
          if (!proj[0]) throw new NotFoundError('Project not found');

          if (input.action === 'unlink') {
            await db
              .delete(initiativeProject)
              .where(
                and(
                  eq(initiativeProject.initiativeId, input.initiativeId),
                  eq(initiativeProject.projectId, input.targetId),
                  eq(initiativeProject.organizationId, input.orgId),
                ),
              );
            return jsonResult({ linked: false });
          }
          const existing = await db
            .select({ initiativeId: initiativeProject.initiativeId })
            .from(initiativeProject)
            .where(
              and(
                eq(initiativeProject.initiativeId, input.initiativeId),
                eq(initiativeProject.projectId, input.targetId),
                eq(initiativeProject.organizationId, input.orgId),
              ),
            )
            .limit(1);
          if (!existing[0]) {
            await db.insert(initiativeProject).values({
              initiativeId: input.initiativeId,
              projectId: input.targetId,
              organizationId: input.orgId,
            });
          }
          return jsonResult({ linked: true });
        }

        const prog = await db
          .select({ id: program.id })
          .from(program)
          .where(and(eq(program.id, input.targetId), eq(program.organizationId, input.orgId)))
          .limit(1);
        if (!prog[0]) throw new NotFoundError('Program not found');

        if (input.action === 'unlink') {
          await db
            .delete(initiativeProgram)
            .where(
              and(
                eq(initiativeProgram.initiativeId, input.initiativeId),
                eq(initiativeProgram.programId, input.targetId),
                eq(initiativeProgram.organizationId, input.orgId),
              ),
            );
          return jsonResult({ linked: false });
        }
        const existing = await db
          .select({ initiativeId: initiativeProgram.initiativeId })
          .from(initiativeProgram)
          .where(
            and(
              eq(initiativeProgram.initiativeId, input.initiativeId),
              eq(initiativeProgram.programId, input.targetId),
              eq(initiativeProgram.organizationId, input.orgId),
            ),
          )
          .limit(1);
        if (!existing[0]) {
          await db.insert(initiativeProgram).values({
            initiativeId: input.initiativeId,
            programId: input.targetId,
            organizationId: input.orgId,
          });
        }
        return jsonResult({ linked: true });
      }),
  );
}
