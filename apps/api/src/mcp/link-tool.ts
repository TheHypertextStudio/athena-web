/**
 * `@docket/api` — the `link` tool: every relation between two pieces of work, in one verb.
 *
 * @remarks
 * "What's blocking the launch?" and "put this project under the Q3 initiative" are the same kind of
 * statement — one thing stands in a named relation to another. The old surface split that across
 * four tools with four argument shapes (`add_task_dependency`, `remove_task_dependency`,
 * `link_initiative`, and reparenting, which had no tool at all), so an agent had to know which
 * table the relation lived in before it could express the sentence.
 *
 * One verb, a `relation` naming which, and a `remove` flag for the other direction. Removing is the
 * same call rather than a separate tool, because "no longer blocks" is not a different idea from
 * "blocks". Each relation lives in its own module and works out which kinds of work it was handed,
 * so a call that names two projects writes the project graph and a call that names two tasks
 * writes the task graph.
 *
 * Single-valued placements — a task's project, milestone, cycle, or program, and a project's
 * program — are fields, and `update` sets them.
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { originFor } from '../lib/provenance/context';
import { enqueueSearchUpsert } from '../search/write-through';
import type { McpContext } from './auth';
import type { McpRegistrar } from './catalog';
import { recordToolChangeSet } from './tool-activity';
import { DESCRIPTOR_HINT } from './descriptors';
import { applyBlocks } from './link-blocks';
import { actorInitiativeAccess, applyContributesTo, applyNestedUnder } from './link-containers';
import { applyRelatesTo, applySubtaskOf } from './link-task-relations';
import {
  ENDPOINT_KINDS,
  RELATIONS,
  type Relation,
  type RelationRequest,
  type RelationResult,
} from './link-types';
import { authorize, jsonResult, runTool, scopedActor } from './result';
import { orgIdParam } from './tools-shared';

/** Which module writes each relation. */
const APPLY: Record<Relation, (request: RelationRequest) => Promise<RelationResult>> = {
  blocks: applyBlocks,
  relates_to: applyRelatesTo,
  subtask_of: applySubtaskOf,
  contributes_to: applyContributesTo,
  nested_under: applyNestedUnder,
};

/** What `link` tells a caller it can do, one line per relation. */
const DESCRIPTION = [
  'State that one piece of work stands in a relation to another; pass `remove: true` to take it back. The relations and the pairs each one joins:',
  '- `blocks`: task → task, or project → project. The first must finish before the second. Refused when it would close a cycle.',
  '- `relates_to`: task ↔ task, in no particular direction.',
  '- `subtask_of`: task → parent task. A task has one parent, so linking it to another parent moves it; removing makes it top level.',
  '- `contributes_to`: project or program → initiative. A project or program may contribute to several initiatives.',
  '- `nested_under`: initiative → parent initiative in this workspace. An initiative has one parent, so nesting it under another moves it; removing makes it top level.',
  'Tasks are named by id; projects, programs, and initiatives by id or name. A pair a relation does not join is refused with the kinds it accepts as the allowed values. Single-valued placements — a task’s project, milestone, cycle, or program, and a project’s program — are fields set with `update`. Reversible with `undo`.',
].join('\n');

/** The MCP declaration for `link`. */
const linkToolDefinition = {
  title: 'Link work',
  description: DESCRIPTION,
  inputSchema: {
    orgId: orgIdParam,
    relation: z.enum(RELATIONS).describe('Which relation holds between `from` and `to`.'),
    from: z
      .string()
      .describe(
        `The subject: the blocking task or project, a related task, the child task, the contributing project or program, or the child initiative. ${DESCRIPTOR_HINT} Tasks must be given by id.`,
      ),
    to: z
      .string()
      .describe(
        `The object: the blocked task or project, the other related task, the parent task, the initiative contributed to, or the parent initiative. ${DESCRIPTOR_HINT} Tasks must be given by id.`,
      ),
    remove: z
      .boolean()
      .optional()
      .describe('Take the relation back instead of asserting it. Defaults to false.'),
  },
  outputSchema: {
    relation: z.enum(RELATIONS),
    from: z.string().describe('The resolved subject id.'),
    to: z.string().describe('The resolved object id.'),
    fromKind: z.enum(ENDPOINT_KINDS).describe('What kind of work the subject is.'),
    toKind: z.enum(ENDPOINT_KINDS).describe('What kind of work the object is.'),
    linked: z.boolean().describe('True when the relation now holds, false when it no longer does.'),
    changed: z.boolean().describe('False when it already stood that way and nothing was written.'),
    changeSetId: z.string().nullable().describe('Pass to `undo`. Null when nothing changed.'),
  },
  annotations: {
    readOnlyHint: false,
    // With `remove: true` it takes a relation away, which the caller should see before approving.
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
};

/** One `link` call's arguments. */
interface LinkInput {
  readonly orgId: string;
  readonly relation: Relation;
  readonly from: string;
  readonly to: string;
  readonly remove?: boolean | undefined;
}

/** Apply one relation as the caller, record it, and report what happened. */
async function link(ctx: McpContext, input: LinkInput): Promise<CallToolResult> {
  const actorCtx = await scopedActor(ctx, input.orgId, 'work:write');
  const remove = input.remove === true;
  const result = await APPLY[input.relation]({
    orgId: input.orgId,
    actorId: actorCtx.actorId,
    from: input.from,
    to: input.to,
    remove,
    guard: async (kind, id) => {
      await authorize(actorCtx, 'contribute', { kind, id, orgId: input.orgId });
    },
    access: actorInitiativeAccess(actorCtx.actorId),
  });

  const verb = remove ? 'Unlinked' : 'Linked';
  const changeSetId = result.changed
    ? await recordToolChangeSet({
        orgId: input.orgId,
        actorId: actorCtx.actorId,
        origin: originFor('link'),
        summary: `${verb} ${input.relation.replace(/_/g, ' ')}`,
        changes: result.changes,
      })
    : null;

  for (const id of result.reindex) await enqueueSearchUpsert(input.orgId, 'task', id);

  return jsonResult({
    relation: input.relation,
    from: result.from,
    to: result.to,
    fromKind: result.fromKind,
    toKind: result.toKind,
    linked: !remove,
    changed: result.changed,
    changeSetId,
  });
}

/** Register `link` on `server`. */
export function registerLinkTool(server: McpRegistrar, ctx: McpContext): void {
  server.registerTool('link', linkToolDefinition, (input) => runTool(() => link(ctx, input)));
}
