/**
 * `@docket/api` — the `organize` tool: a whole plan written in one call.
 *
 * @remarks
 * "Set up a Q3 platform initiative with three projects under it" was 44 calls on the old surface,
 * and it could not actually be done: a task had no way to reference a project created in the same
 * turn, so the agent had to create the parent, read back its id, and only then file children — a
 * round trip per node, with a half-built tree left behind whenever one of them failed.
 *
 * This takes the whole shape at once. Items reference each other by a local `ref` the caller
 * invents, which is resolved to real ids as the tree is walked parents-first, and the walk runs in
 * one serializable transaction so a failure anywhere leaves nothing behind.
 *
 * **It reconciles rather than duplicating.** Running the same plan twice is the normal case, not an
 * error — someone re-pastes an updated doc, or an agent retries after a timeout. So each item is
 * matched against what already exists in its parent's scope, and the result says per item whether
 * it was created or matched. Without that, the second run of a document import silently doubles a
 * workspace.
 */
import { z } from 'zod';

import { NotFoundError } from '../error';
import {
  KINDS,
  MAX_ITEMS,
  OrganizeItem,
  type Placed,
  type Placement,
  assertPriorities,
  inParentOrder,
  placeItem,
  resolveItem,
} from '../lib/organize/place';
import { originFor } from '../lib/provenance/context';
import { resolveLandingTarget } from '../lib/task-landing';
import { serializableTx } from '../lib/serializable-tx';
import {
  applySubtaskCompletionPolicyForParents,
  finishTaskStateTransition,
} from '../lib/task-state';
import { enqueueSearchUpsert } from '../search/write-through';
import type { McpContext } from './auth';
import type { McpRegistrar } from './catalog';
import { recordChangeSet, type ChangeRecord } from './change-set';
import { WIDGET, widgetMeta } from './apps';
import { authorize, jsonResult, runTool, scopedActor } from './result';
import { orgIdParam, resolveStateTransition } from './tools-shared';

/** Register `organize` on `server`. */
export function registerOrganizeTool(server: McpRegistrar, ctx: McpContext): void {
  server.registerTool(
    'organize',
    {
      title: 'Organize work',
      description:
        'Create a whole plan — initiatives, programs, projects, and tasks — in one call, with children naming their parent by a local `ref` you invent. Running the same plan twice does not duplicate it: anything already there by that name in that place is matched and reused, and the result says which was which. Use this for turning a document or a conversation into structure; use capture for a single task.',
      inputSchema: {
        orgId: orgIdParam,
        items: z
          .array(OrganizeItem)
          .min(1)
          .max(MAX_ITEMS)
          .describe('The plan. Order does not matter — parents are placed first either way.'),
      },
      outputSchema: {
        placed: z
          .array(
            z.object({
              ref: z.string().describe('The handle you gave it.'),
              kind: z.enum(KINDS),
              id: z.string().describe('Its real id.'),
              title: z.string().describe('What it is called.'),
              href: z.string().describe('Where it lives in the product app.'),
              parent: z
                .string()
                .optional()
                .describe('The `ref` of the item in this call it was placed under, when any.'),
              created: z
                .boolean()
                .describe('False when an existing item of that name was matched instead.'),
            }),
          )
          .describe('Every item, in the order it was placed.'),
        created: z.number().int().describe('How many were new.'),
        matched: z.number().int().describe('How many already existed.'),
        changeSetId: z
          .string()
          .nullable()
          .describe('Pass to `undo` to take the whole plan back. Null when nothing was created.'),
      },
      _meta: widgetMeta(WIDGET.changeReport),
      annotations: {
        readOnlyHint: false,
        // It only creates and links; nothing existing is overwritten.
        destructiveHint: false,
        // Reconciliation is what makes this true: a repeat run matches instead of duplicating.
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

        const ordered = inParentOrder(input.items);
        assertPriorities(ordered);
        const landing = await resolveLandingTarget(input.orgId, actorCtx.actorId);
        if (!landing) throw new NotFoundError('No team to organize into');

        // Every descriptor and workflow state is resolved BEFORE the transaction opens. None of
        // them depend on anything the plan writes, and resolving them inside would mean issuing
        // reads on a connection the transaction already holds — which does not merely read stale
        // data, it stalls. A bad name therefore fails before a single row is written.
        const prepared = await Promise.all(
          ordered.map(async (item, index) => {
            const refs = await resolveItem(input.orgId, item);
            const state =
              item.state === undefined
                ? {
                    statusId: landing.statusId,
                    state: landing.state,
                    completedAt: null,
                    canceledAt: null,
                  }
                : await resolveStateTransition(
                    input.orgId,
                    refs.teamId ?? landing.teamId,
                    item.state,
                    `items.${index}.state`,
                  );
            return { item, refs, state };
          }),
        );

        const placed: Placed[] = [];
        const byRef = new Map<string, Placed>();
        const changes: ChangeRecord[] = [];

        const cascades = await serializableTx(async (tx) => {
          const parentTaskIds: (string | null)[] = [];
          for (const { item, refs, state } of prepared) {
            /** The already-placed parent from this call, if the item named one. */
            const local = item.parent === undefined ? undefined : byRef.get(item.parent);

            const at: Placement = {
              projectId: (local?.kind === 'project' ? local.id : undefined) ?? refs.projectId,
              programId: (local?.kind === 'program' ? local.id : undefined) ?? refs.programId,
              initiativeId:
                (local?.kind === 'initiative' ? local.id : undefined) ?? refs.initiativeId,
              parentTaskId: local?.kind === 'task' ? local.id : null,
            };

            const result = await placeItem(tx, {
              orgId: input.orgId,
              actorId: actorCtx.actorId,
              item,
              at,
              teamId: refs.teamId ?? landing.teamId,
              state,
              assigneeId: refs.assigneeId,
              ownerId: refs.ownerId,
              leadId: refs.leadId,
            });

            placed.push(result.placed);
            byRef.set(item.ref, result.placed);
            if (result.change) changes.push(result.change);
            if (result.placed.kind === 'task' && result.placed.created) {
              parentTaskIds.push(at.parentTaskId);
            }
          }
          return applySubtaskCompletionPolicyForParents(tx, input.orgId, parentTaskIds);
        });

        // Search indexing and change recording both happen after commit: a rolled-back plan must
        // not leave an index entry pointing at a row that never existed, or an undo for it.
        for (const row of placed) {
          if (row.created) await enqueueSearchUpsert(input.orgId, row.kind, row.id);
        }
        for (const cascade of cascades) {
          await finishTaskStateTransition({ actorId: null }, cascade);
        }
        const created = placed.filter((row) => row.created).length;
        const changeSetId = await recordChangeSet({
          orgId: input.orgId,
          actorId: actorCtx.actorId,
          origin: originFor('organize'),
          summary:
            created === 1 && placed[0]
              ? `Created "${ordered[0]?.title}"`
              : `Created ${created} items`,
          changes,
        });

        return jsonResult({
          placed,
          created,
          matched: placed.length - created,
          changeSetId,
        });
      }),
  );
}
