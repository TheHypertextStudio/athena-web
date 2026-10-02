/**
 * `@docket/api` — the intent-shaped write tools, and the undo that makes them safe.
 *
 * @remarks
 * These are named for what a person is trying to do rather than for the row they touch. `capture`
 * exists because "add a task from what we just discussed" should not require knowing an org's team
 * layout, its workflow states, or which cycle is current — `resolveLandingTarget` knows all three,
 * and an agent that has to ask first is an agent that gets them wrong.
 *
 * Every write here records a change set, because the surface executes immediately instead of
 * proposing. That is only a defensible trade if the caller can see what happened and reverse it.
 */
import { TaskId } from '@docket/work/ids';
import { z } from 'zod';

import { NotFoundError } from '../error';
import { createCapturedTasks } from './capture-template-tasks';
import { templateDecisionFields, requireTemplateDecisions } from './template-selection';
import { Priority } from '@docket/work/task-contract';
import { LabelId } from '@docket/work/ids';
import { originFor } from '../lib/provenance/context';
import { resolveLandingTarget } from '../lib/task-landing';
import { enqueueSearchUpsert } from '../search/write-through';
import type { McpContext } from './auth';
import type { McpRegistrar } from './catalog';
import { recordChangeSet, trackedFields, undoChangeSet, type UndoOutcome } from './change-set';
import { isCompanionKind } from './change-set-companions';
import { WIDGET, widgetMeta } from './apps';
import { authorize, jsonResult, runTool, scopedActor } from './result';
import { orgIdParam } from './tools-shared';
import { latestOwnChangeSet } from './undo-target';
import { entityHref, entityListHref } from './entity-href';

/**
 * The most tasks one capture call may create.
 *
 * @remarks
 * Matches the scope cap in `update` and `archive`. Longer lists belong in `organize`, which can
 * place items under a parent instead of landing them all loose on one team.
 */
const MAX_CAPTURES = 100;

/**
 * How many search publishes run at once after a capture.
 *
 * @remarks
 * Each one opens its own transaction. The pool holds ten connections and the dev/test database is a
 * single PGlite connection, so the fan-out stays well inside both.
 */
const SEARCH_PUBLISH_BATCH = 8;

/**
 * Whether undo should re-index a reverted entry by its kind.
 *
 * @remarks
 * Label-set and catalog reverts re-index the tables they actually touched after their own commit,
 * so publishing their entry kind (`task_labels`, `template`) here would only send the search index
 * a table it does not have.
 */
function reindexes(outcome: UndoOutcome): boolean {
  return outcome.reverted && !isCompanionKind(outcome.kind);
}

/** Register capture and undo on `server`. */
export function registerWriteTools(server: McpRegistrar, ctx: McpContext): void {
  server.registerTool(
    'capture',
    {
      title: 'Capture',
      description:
        'Create tasks from text. Before writing a structured task body, call list_templates with targetType task and look for a relevant template. Read its literal Markdown in payload.description, keep its sections, and fill them with the task details instead of inventing a format. Pass template by ID or name. With a template, one-line text is the title and omitted description copies the saved Markdown; multiline text is an explicit body. Explicit description, priority, and labelIds override defaults. The result returns the saved body for filling through update. Supply withoutTemplateReason for freeform text or quick capture. When eligible templates exist and neither choice is supplied, no tasks are created and choices are returned. The team, workflow state, current cycle, and assignee are all resolved for you, so this is the cheapest path from a sentence to a tracked piece of work. `text` takes a list, so capturing ten things said in one breath is one call and not ten. Use organize when the things need placing under a project or each other.',
      inputSchema: {
        orgId: orgIdParam,
        ...templateDecisionFields,
        description: z
          .string()
          .optional()
          .describe(
            'An explicit completed Markdown body, including an empty string to suppress the template body. Shared by all captures in this call.',
          ),
        priority: Priority.optional(),
        labelIds: z.array(LabelId).optional(),
        text: z
          .union([z.string().min(1), z.array(z.string().min(1)).min(1).max(MAX_CAPTURES)])
          .describe(
            'The completed task text, as one string or a list. Generally write its body using a relevant template from list_templates: preserve the Markdown structure and fill its sections. Each becomes its own task: the first line is the title, the whole thing is the description, so pasting several lines is fine.',
          ),
      },
      outputSchema: {
        items: z
          .array(
            z.object({
              id: TaskId,
              title: z.string(),
              description: z
                .string()
                .nullable()
                .describe('The saved body. Fill template sections through update.'),
              href: z.string().describe('Where it lives in the product app.'),
              state: z.string().describe("The workflow state it landed in — the team's first."),
              teamId: z.string().describe('The team it landed on.'),
            }),
          )
          .describe('One entry per captured task, in the order given.'),
        listHref: z.string().describe('The page listing tasks, for what the card cannot fit.'),
        changeSetId: z.string().describe('Pass to `undo` to take the whole call back.'),
      },
      _meta: widgetMeta(WIDGET.changeReport),
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

        const landing = await resolveLandingTarget(input.orgId, actorCtx.actorId);
        if (!landing) throw new NotFoundError('No team to capture into');

        const texts = Array.isArray(input.text) ? input.text : [input.text];
        const selection = await requireTemplateDecisions(input.orgId, actorCtx.actorId, [
          {
            ...input,
            ref: 'text',
            kind: 'task',
            teamId: landing.teamId,
          },
        ]);
        if (selection) return selection;
        const rows = await createCapturedTasks(
          input.orgId,
          actorCtx.actorId,
          texts,
          landing,
          input,
        );
        const first = rows[0];
        /* v8 ignore next -- @preserve defensive: insert always returns a row per value */
        if (!first) throw new Error('capture insert returned no row');

        // Concurrently, in bounded batches, the way `content/unfurl-sweep.ts` publishes. Each
        // publish fans out to four subscribers and costs several round trips, so awaiting them one
        // at a time made a 100-task capture wait on ~500 sequential queries. The batch is narrower
        // than the sweep's because these run against one pooled connection mid-request.
        for (let start = 0; start < rows.length; start += SEARCH_PUBLISH_BATCH) {
          await Promise.all(
            rows
              .slice(start, start + SEARCH_PUBLISH_BATCH)
              .map((row) => enqueueSearchUpsert(input.orgId, 'task', row.id)),
          );
        }

        const changeSetId = await recordChangeSet({
          orgId: input.orgId,
          actorId: actorCtx.actorId,
          origin: originFor('capture'),
          summary:
            rows.length === 1
              ? `Captured "${first.title}"`
              : `Captured ${String(rows.length)} tasks`,
          // One change set for the call, so `undo` reverses the whole capture.
          changes: rows.map((row) => ({
            kind: 'task' as const,
            id: row.id,
            op: 'create' as const,
            after: trackedFields('task', row),
          })),
        });

        return jsonResult({
          items: rows.map((row) => ({
            id: row.id,
            title: row.title,
            description: row.description,
            href: entityHref(input.orgId, 'task', row.id),
            state: row.state,
            teamId: row.teamId,
          })),
          listHref: entityListHref(input.orgId, 'task'),
          changeSetId,
        });
      }),
  );

  server.registerTool(
    'undo',
    {
      title: 'Undo',
      description:
        'Reverse a change a tool made, by its changeSetId. Omit the id to reverse the most recent change you made in this workspace. Anything edited by someone else since is left alone and reported back rather than overwritten, so a partial undo is a normal outcome worth reading.',
      inputSchema: {
        orgId: orgIdParam,
        changeSetId: z
          .string()
          .optional()
          .describe('The change to reverse. Defaults to your most recent one in this workspace.'),
      },
      outputSchema: {
        summary: z.string().describe('What the reversed change had done.'),
        reverted: z.number().int().describe('How many entities were put back.'),
        skipped: z
          .array(
            z.object({
              kind: z.string(),
              id: z.string(),
              reason: z.string(),
            }),
          )
          .describe('Entities left alone, and why — `changed_since` means someone else edited it.'),
      },
      annotations: {
        title: 'Undo',
        readOnlyHint: false,
        // Reversing a change is itself a change: it can archive rows a create added.
        destructiveHint: true,
        idempotentHint: true,
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

        // Defaulting to the caller's own latest change is scoped to their actor and to the door
        // they came through: "undo that" never reaches for a colleague's work or an app edit.
        const targetId =
          input.changeSetId ?? (await latestOwnChangeSet(input.orgId, actorCtx.actorId));
        if (!targetId) throw new NotFoundError('Nothing to undo');

        const { summary, outcomes } = await undoChangeSet(input.orgId, targetId);
        for (const outcome of outcomes) {
          if (reindexes(outcome)) await enqueueSearchUpsert(input.orgId, outcome.kind, outcome.id);
        }

        return jsonResult({
          summary,
          reverted: outcomes.filter((outcome) => outcome.reverted).length,
          skipped: outcomes
            .filter((outcome) => !outcome.reverted)
            .map(({ kind, id, reason }) => ({ kind, id, reason: reason ?? 'unknown' })),
        });
      }),
  );
}
