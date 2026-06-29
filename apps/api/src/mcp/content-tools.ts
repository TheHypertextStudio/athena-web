import { comment, db, integration, task, team, update } from '@docket/db';
import { Health } from '@docket/types';
import type { McpRegistrar } from './catalog';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { NotFoundError, ValidationError } from '../error';
import type { McpContext } from './auth';
import { jsonResult, runTool, scopedActor, authorize } from './result';
import { subjectTable } from './tools-shared';

/** Register add_comment, post_update, link_external on `server`. */
export function registerContentTools(server: McpRegistrar, ctx: McpContext): void {
  server.registerTool(
    'add_comment',
    {
      title: 'Add comment',
      description: "Post a comment on a task/project/program/initiative (the caller's own actor).",
      inputSchema: {
        orgId: z.string().min(1),
        subjectType: z.enum(['task', 'project', 'program', 'initiative']),
        subjectId: z.string().min(1),
        body: z.string().min(1),
        parentCommentId: z.string().optional(),
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
        // The comments router gates create on the `comment` capability.
        const actorCtx = await scopedActor(ctx, input.orgId, 'work:write');
        await authorize(actorCtx, 'comment', {
          kind: input.subjectType,
          id: input.subjectId,
          orgId: input.orgId,
        });

        if (input.parentCommentId !== undefined) {
          const parentRows = await db
            .select()
            .from(comment)
            .where(
              and(eq(comment.id, input.parentCommentId), eq(comment.organizationId, input.orgId)),
            )
            .limit(1);
          const parent = parentRows[0];
          if (!parent) throw new NotFoundError('Parent comment not found');
          if (parent.subjectType !== input.subjectType || parent.subjectId !== input.subjectId) {
            throw new ValidationError(
              new z.ZodError([
                {
                  code: 'custom',
                  path: ['parentCommentId'],
                  message: 'Parent comment is on a different subject',
                  input: input.parentCommentId,
                },
              ]),
            );
          }
          if (parent.parentCommentId !== null) {
            throw new ValidationError(
              new z.ZodError([
                {
                  code: 'custom',
                  path: ['parentCommentId'],
                  message: 'Cannot reply to a reply; replies are single-level',
                  input: input.parentCommentId,
                },
              ]),
            );
          }
        }

        const inserted = await db
          .insert(comment)
          .values({
            organizationId: input.orgId,
            authorId: actorCtx.actorId,
            subjectType: input.subjectType,
            subjectId: input.subjectId,
            body: input.body,
            parentCommentId: input.parentCommentId,
            createdBy: actorCtx.actorId,
          })
          .returning();
        const row = inserted[0];
        /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
        if (!row) throw new Error('comment insert returned no row');
        return jsonResult({ id: row.id, subjectType: row.subjectType, subjectId: row.subjectId });
      }),
  );

  server.registerTool(
    'post_update',
    {
      title: 'Post status update',
      description:
        "Post a status update on a project/program/initiative; the latest health also sets the subject's current health.",
      inputSchema: {
        orgId: z.string().min(1),
        subjectType: z.enum(['project', 'program', 'initiative']),
        subjectId: z.string().min(1),
        body: z.string().min(1),
        health: Health.optional(),
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
          kind: input.subjectType,
          id: input.subjectId,
          orgId: input.orgId,
        });

        const row = await db.transaction(async (tx) => {
          const inserted = await tx
            .insert(update)
            .values({
              organizationId: input.orgId,
              authorId: actorCtx.actorId,
              subjectType: input.subjectType,
              subjectId: input.subjectId,
              health: input.health,
              body: input.body,
              createdBy: actorCtx.actorId,
            })
            .returning();
          const created = inserted[0];
          /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
          if (!created) throw new Error('update insert returned no row');

          if (input.health !== undefined) {
            const tbl = subjectTable[input.subjectType];
            await tx
              .update(tbl)
              .set({ health: input.health })
              .where(and(eq(tbl.id, input.subjectId), eq(tbl.organizationId, input.orgId)));
          }
          return created;
        });
        return jsonResult({ id: row.id, subjectType: row.subjectType, subjectId: row.subjectId });
      }),
  );

  server.registerTool(
    'link_external',
    {
      title: 'Link external item',
      description:
        'Materialize an external item as a linked task carrying its provenance, idempotently.',
      inputSchema: {
        orgId: z.string().min(1),
        integrationId: z.string().min(1),
        teamId: z.string().min(1),
        title: z.string().min(1),
        externalId: z.string().min(1),
        description: z.string().optional(),
        externalUrl: z.string().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        // Linking touches an external system (resolves provenance via the org's
        // Integration credentials) → open world.
        openWorldHint: true,
      },
    },
    (input) =>
      runTool(async () => {
        const actorCtx = await scopedActor(ctx, input.orgId, 'connectors:link');
        await authorize(actorCtx, 'contribute', {
          kind: 'organization',
          id: input.orgId,
          orgId: input.orgId,
        });

        const integrationRows = await db
          .select({ id: integration.id })
          .from(integration)
          .where(
            and(
              eq(integration.id, input.integrationId),
              eq(integration.organizationId, input.orgId),
            ),
          )
          .limit(1);
        if (!integrationRows[0]) throw new NotFoundError('Integration not found');

        const teamRows = await db
          .select({ workflowStates: team.workflowStates })
          .from(team)
          .where(and(eq(team.id, input.teamId), eq(team.organizationId, input.orgId)))
          .limit(1);
        const teamRow = teamRows[0];
        if (!teamRow) throw new NotFoundError('Team not found');

        const existing = await db
          .select({ id: task.id })
          .from(task)
          .where(
            and(
              eq(task.organizationId, input.orgId),
              eq(task.source, 'linked'),
              eq(task.sourceIntegrationId, input.integrationId),
              eq(task.externalId, input.externalId),
            ),
          )
          .limit(1);
        if (existing[0]) return jsonResult({ id: existing[0].id, alreadyLinked: true });

        const state = teamRow.workflowStates[0]?.key ?? 'backlog';
        const inserted = await db
          .insert(task)
          .values({
            organizationId: input.orgId,
            title: input.title,
            description: input.description ?? null,
            teamId: input.teamId,
            state,
            source: 'linked',
            sourceIntegrationId: input.integrationId,
            externalId: input.externalId,
            externalUrl: input.externalUrl ?? null,
            sourceSyncMode: 'mirror',
            createdBy: actorCtx.actorId,
          })
          .returning();
        const row = inserted[0];
        /* v8 ignore next -- @preserve defensive: linked task insert returned no row */
        if (!row) throw new Error('linked task insert returned no row');
        return jsonResult({ id: row.id, alreadyLinked: false });
      }),
  );
}
