import { DeliverableIds, DeliverableOut } from '@docket/work/attachment-contract';
import {
  claimDeliverables,
  indexDeliverables,
  withPostDeliverables,
} from '../content/deliverables';
import { comment, db, integration, task, team, update } from '@docket/db';
import { CommentId, TaskId, UpdateId } from '@docket/work/ids';
import { Health } from '@docket/work/capability-contract';
import { IntegrationId } from '@docket/connections/ids';
import type { McpRegistrar } from './catalog';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { NotFoundError, ValidationError } from '../error';
import { assertTaskCapability, loadTask } from '../routes/task-helpers';
import { enqueueSearchUpsert } from '../search/write-through';
import type { McpContext } from './auth';
import { jsonResult, runTool, scopedActor, authorize } from './result';
import { DESCRIPTOR_HINT, resolveSubject } from './descriptors';
import { orgIdParam, subjectTable } from './tools-shared';
import { landingStatus } from '../lib/work-status';
import { authoredContent } from '../lib/provenance/authored-content';
import {
  contentRequestHash,
  mcpReceiptCallerKey,
  readMcpContentReceipt,
  saveMcpContentReceipt,
} from './content-receipts';

const contentRetryRequestId = z
  .uuid()
  .optional()
  .describe(
    'Optional retry key. Reuse the same key and arguments for 48 hours after an uncertain result.',
  );

/** Register comment, report_status, link_external on `server`. */
export function registerContentTools(server: McpRegistrar, ctx: McpContext): void {
  server.registerTool(
    'comment',
    {
      title: 'Comment',
      description:
        'Post a comment on a task, project, program, or initiative, as the caller. Attach private deliverable draft IDs from upload_deliverable or create_deliverable_upload_session; the response returns their file metadata and download URLs. Replies are one level deep — a reply cannot itself be replied to. Use report_status instead when the point is how a container is tracking rather than a remark on it.',
      inputSchema: {
        orgId: orgIdParam,
        subjectType: z
          .enum(['task', 'project', 'program', 'initiative'])
          .describe('What kind of thing is being commented on.'),
        subjectId: z
          .string()
          .min(1)
          .describe(
            `The thing being commented on. ${DESCRIPTOR_HINT} Tasks must be given by id, since titles repeat.`,
          ),
        attachmentIds: DeliverableIds,
        requestId: contentRetryRequestId,
        body: z.string().min(1).describe('The comment text, as markdown.'),
        parentCommentId: z
          .string()
          .optional()
          .describe(
            'Reply to this comment. Threads are one level deep — a reply cannot itself be replied to.',
          ),
      },
      outputSchema: {
        id: CommentId,
        subjectType: z.string(),
        subjectId: z.string(),
        attachments: z.array(DeliverableOut).optional(),
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
        // Resolution doubles as the tenant check: a descriptor only matches within this org.
        const subjectId = await resolveSubject(
          input.orgId,
          input.subjectType,
          input.subjectId,
          'subjectId',
        );
        if (input.subjectType === 'task') {
          // A task comment changes task-attached discussion, so it follows the same current-task
          // contribution boundary as the REST route rather than a generic org comment grant.
          await assertTaskCapability(
            input.orgId,
            actorCtx.actorId,
            await loadTask(input.orgId, subjectId),
            'contribute',
          );
        } else {
          // Non-task comments retain the existing polymorphic subject capability contract.
          await authorize(actorCtx, 'comment', {
            kind: input.subjectType,
            id: subjectId,
            orgId: input.orgId,
          });
        }

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
          if (parent.subjectType !== input.subjectType || parent.subjectId !== subjectId) {
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

        const row = await createCommentWithFiles(input, subjectId, actorCtx.actorId, {
          callerKey: mcpReceiptCallerKey({
            actorId: actorCtx.actorId,
            principal: ctx.principal,
            clientId: ctx.clientId,
          }),
          toolName: 'comment',
          requestId: input.requestId,
          requestHash: contentRequestHash({
            subjectType: input.subjectType,
            subjectId,
            body: input.body,
            parentCommentId: input.parentCommentId,
            attachmentIds: input.attachmentIds,
          }),
        });
        await indexDeliverables(input.orgId, input.attachmentIds);
        await enqueueSearchUpsert(input.orgId, 'comment', row.id);
        const post = await withPostDeliverables(input.orgId, actorCtx.actorId, 'comment', row);
        return jsonResult({
          id: row.id,
          subjectType: row.subjectType,
          subjectId: row.subjectId,
          ...(post.attachments ? { attachments: post.attachments } : {}),
        });
      }),
  );

  server.registerTool(
    'report_status',
    {
      title: 'Report status',
      description:
        'Explain project/program/initiative status in prose with optional health rating, which becomes its current health. Attach private draft IDs from upload_deliverable/create_deliverable_upload_session for file metadata and download URLs. Use this to explain health; update sets the field without explaining why.',
      inputSchema: {
        orgId: orgIdParam,
        subjectType: z
          .enum(['project', 'program', 'initiative'])
          .describe(
            'What the update is about. Tasks do not take status updates; comment on them instead.',
          ),
        subjectId: z.string().min(1).describe(`The thing being reported on. ${DESCRIPTOR_HINT}`),
        attachmentIds: DeliverableIds,
        requestId: contentRetryRequestId,
        body: z.string().min(1).describe('The narrative update, as markdown.'),
        health: Health.optional(),
      },
      outputSchema: {
        id: UpdateId,
        subjectType: z.string(),
        subjectId: z.string(),
        attachments: z.array(DeliverableOut).optional(),
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
        const subjectId = await resolveSubject(
          input.orgId,
          input.subjectType,
          input.subjectId,
          'subjectId',
        );
        await authorize(actorCtx, 'contribute', {
          kind: input.subjectType,
          id: subjectId,
          orgId: input.orgId,
        });

        const receiptInput = {
          callerKey: mcpReceiptCallerKey({
            actorId: actorCtx.actorId,
            principal: ctx.principal,
            clientId: ctx.clientId,
          }),
          toolName: 'report_status',
          requestId: input.requestId,
          requestHash: contentRequestHash({
            subjectType: input.subjectType,
            subjectId,
            body: input.body,
            health: input.health,
            attachmentIds: input.attachmentIds,
          }),
        };
        const row = await db.transaction(async (tx) => {
          const priorId = await readMcpContentReceipt(tx, {
            organizationId: input.orgId,
            ...receiptInput,
          });
          if (priorId) {
            const [prior] = await tx
              .select()
              .from(update)
              .where(and(eq(update.id, priorId), eq(update.organizationId, input.orgId)))
              .limit(1);
            if (!prior) throw new NotFoundError('Update not found');
            return prior;
          }
          const inserted = await tx
            .insert(update)
            .values({
              organizationId: input.orgId,
              ...authoredContent(actorCtx.actorId, 'report_status'),
              subjectType: input.subjectType,
              subjectId,
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
              .where(and(eq(tbl.id, subjectId), eq(tbl.organizationId, input.orgId)));
          }
          await claimDeliverables(
            tx,
            input.orgId,
            actorCtx.actorId,
            { kind: 'update', id: created.id },
            input.attachmentIds,
          );
          await saveMcpContentReceipt(tx, {
            organizationId: input.orgId,
            ...receiptInput,
            postId: created.id,
          });
          return created;
        });
        await indexDeliverables(input.orgId, input.attachmentIds);
        await enqueueSearchUpsert(input.orgId, 'update', row.id);
        await enqueueSearchUpsert(input.orgId, row.subjectType, row.subjectId);
        const post = await withPostDeliverables(input.orgId, actorCtx.actorId, 'update', row);
        return jsonResult({
          id: row.id,
          subjectType: row.subjectType,
          subjectId: row.subjectId,
          ...(post.attachments ? { attachments: post.attachments } : {}),
        });
      }),
  );

  registerExternalLinkTool(server, ctx);
}

async function createCommentWithFiles(
  input: {
    orgId: string;
    subjectType: 'task' | 'project' | 'program' | 'initiative';
    body: string;
    parentCommentId?: string | undefined;
    attachmentIds?: string[] | undefined;
  },
  subjectId: string,
  actorId: string,
  receipt: {
    readonly callerKey: string;
    readonly toolName: string;
    readonly requestId?: string | undefined;
    readonly requestHash: string;
  },
) {
  return db.transaction(async (tx) => {
    const priorId = await readMcpContentReceipt(tx, {
      organizationId: input.orgId,
      ...receipt,
    });
    if (priorId) {
      const [prior] = await tx
        .select()
        .from(comment)
        .where(and(eq(comment.id, priorId), eq(comment.organizationId, input.orgId)))
        .limit(1);
      if (!prior) throw new NotFoundError('Comment not found');
      return prior;
    }
    const inserted = await tx
      .insert(comment)
      .values({
        organizationId: input.orgId,
        ...authoredContent(actorId, 'comment'),
        subjectType: input.subjectType,
        subjectId,
        body: input.body,
        parentCommentId: input.parentCommentId,
        createdBy: actorId,
      })
      .returning();
    const row = inserted[0];
    /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
    if (!row) throw new Error('comment insert returned no row');

    await claimDeliverables(
      tx,
      input.orgId,
      actorId,
      { kind: 'comment', id: row.id },
      input.attachmentIds,
    );
    await saveMcpContentReceipt(tx, {
      organizationId: input.orgId,
      ...receipt,
      postId: row.id,
    });
    return row;
  });
}

const externalLinkTool = {
  title: 'Link external item',
  description:
    'Materialize an external item as a linked task carrying its provenance, idempotently.',
  inputSchema: {
    orgId: orgIdParam,
    integrationId: IntegrationId.describe('The connected integration the item came from.'),
    teamId: z.string().min(1).describe(`The team the linked task lands on. ${DESCRIPTOR_HINT}`),
    title: z.string().min(1).describe("The external item's title."),
    externalId: z
      .string()
      .min(1)
      .describe(
        "The provider's id for the item. Linking is idempotent on this, so a repeat call returns the existing task.",
      ),
    description: z.string().optional().describe('The external body, as markdown.'),
    externalUrl: z.string().optional().describe('A link back to the item in its own system.'),
  },
  outputSchema: {
    id: TaskId,
    alreadyLinked: z.boolean().describe('True when this external item was already linked.'),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    // Linking touches an external system (resolves provenance via the org's
    // Integration credentials) → open world.
    openWorldHint: true,
  },
};

function registerExternalLinkTool(server: McpRegistrar, ctx: McpContext): void {
  server.registerTool(
    'link_external',
    externalLinkTool,

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

        const landing = await landingStatus(input.orgId, 'task', input.teamId);
        const inserted = await db
          .insert(task)
          .values({
            organizationId: input.orgId,
            title: input.title,
            description: input.description ?? null,
            teamId: input.teamId,
            statusId: landing.id,
            state: landing.key,
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
        await enqueueSearchUpsert(input.orgId, 'task', row.id);
        return jsonResult({ id: row.id, alreadyLinked: false });
      }),
  );
}
