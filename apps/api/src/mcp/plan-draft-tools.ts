/**
 * `@docket/api` — the planning canvas tools: `plan_start`, `plan_read`, `plan_draft`, `plan_commit`.
 *
 * @remarks
 * These are how Athena shapes a plan with a person on the canvas. A plan draft is private to its
 * owner and has no workspace consequence until a commit, which is why `plan_start` and
 * `plan_draft` carry the `docket/approval: private_draft` metadata: the loop executes them
 * without a proposal so a conversation can fill the canvas in as it happens. `plan_commit` is an
 * ordinary gated write, so under the default dial Athena's offer to confirm a part of the plan
 * lands in the thread as a proposal the person approves.
 *
 * Every tool resolves the caller as a user principal. A registered agent has no personal plans,
 * so it is told the plan does not exist rather than being refused.
 */
import type { PlanDraftRow } from '../lib/plan-draft/store';
import {
  PlanDocument,
  PlanNodeKind,
  PlanOp,
  PlanPlaced,
  PlanTemplateOption,
  PLAN_TOOL_NAMES,
} from '@docket/work/plan-draft-contract';
import { agentSession, db } from '@docket/db';
import { planCounts } from '@docket/work/plan-draft';
import type { InitiativeId } from '@docket/work/ids';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { NotFoundError } from '../error';
import { commitPlanNodes } from '../lib/plan-draft/commit';
import {
  attachPlanSession,
  createOrReopenPlan,
  listPlanTemplates,
  loadOwnedPlan,
  patchPlan,
  planHref,
} from '../lib/plan-draft/store';
import { WIDGET, widgetMeta } from './apps';
import type { McpContext } from './auth';
import type { McpRegistrar } from './catalog';
import { DESCRIPTOR_HINT, resolveOptional } from './descriptors';
import { authorize, jsonResult, runTool, scopedActor } from './result';
import { orgIdParam } from './tools-shared';

/** The metadata key and value that mark a first-party tool as writing only to a private draft. */
export const PRIVATE_DRAFT_META = { 'docket/approval': 'private_draft' } as const;

/** Annotations for a tool that writes only to the caller's private draft. */
const PRIVATE_DRAFT_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const planIdParam = z.string().min(1).describe('The plan id `plan_start` returned.');

const planCountsSchema = z.object({
  projects: z.number().int(),
  tasks: z.number().int(),
  draft: z.number().int().describe('How many nodes are still drafts.'),
});

/**
 * The Athena session hosting this conversation, when the session id names one.
 *
 * @remarks
 * The same `sessionId` parameter carries an Athena session id when the loop's in-process toolbox
 * built the server and an MCP transport session id when a remote client did. Only the former is a
 * conversation a plan can belong to, so the id is attached only when an `agent_session` row exists.
 */
async function hostingSessionId(sessionId: string | null): Promise<string | null> {
  if (sessionId === null) return null;
  const rows = await db
    .select({ id: agentSession.id })
    .from(agentSession)
    .where(eq(agentSession.id, sessionId))
    .limit(1);
  return rows[0]?.id ?? null;
}

/** The owner behind a user principal, or not-found for a registered agent. */
function ownerOf(ctx: McpContext): string {
  if (ctx.principal.kind !== 'user') throw new NotFoundError('Plan not found');
  return ctx.principal.userId;
}

/** The fields every plan tool reports about a plan. */
function planSummary(row: PlanDraftRow) {
  return {
    planId: row.id,
    href: planHref(row),
    title: row.title,
    status: row.status,
    revision: row.revision,
    counts: planCounts(row.document),
  };
}

/** Register the four planning tools on `server`. */
export function registerPlanDraftTools(
  server: McpRegistrar,
  ctx: McpContext,
  sessionId: string | null,
): void {
  server.registerTool(
    PLAN_TOOL_NAMES.start,
    {
      title: 'Start a plan',
      description:
        'Open a planning draft on the canvas, or reopen the one already rooted on an initiative. Use this the moment the person describes initiative-sized work — a launch, a campaign, a quarter’s goal, anything with several efforts inside it — and tell them in one sentence that the plan is open on the canvas. The result carries the document, the canvas link, and the templates available for each kind; apply the most relevant one when you first draft a node. Nothing is created in the workspace until `plan_commit`.',
      inputSchema: {
        orgId: orgIdParam,
        initiative: z
          .string()
          .optional()
          .describe(`An existing initiative to plan under, when there is one. ${DESCRIPTOR_HINT}`),
        title: z.string().min(1).max(200).optional().describe('A working title for the plan.'),
      },
      outputSchema: {
        planId: z.string(),
        href: z.string().describe('The canvas route to send the person to.'),
        title: z.string(),
        status: z.string(),
        revision: z.number().int(),
        counts: planCountsSchema,
        document: PlanDocument,
        templates: z.array(PlanTemplateOption).describe('Templates each kind may apply.'),
      },
      _meta: { ...PRIVATE_DRAFT_META },
      annotations: PRIVATE_DRAFT_ANNOTATIONS,
    },
    (input) =>
      runTool(async () => {
        const ownerUserId = ownerOf(ctx);
        await scopedActor(ctx, input.orgId, 'work:read');
        const initiativeId = await resolveOptional(
          input.orgId,
          'initiative',
          input.initiative,
          'initiative',
        );
        const hostSessionId = await hostingSessionId(sessionId);
        const created = await createOrReopenPlan(ownerUserId, {
          organizationId: input.orgId,
          ...(initiativeId ? { initiativeId: initiativeId as InitiativeId } : {}),
          ...(input.title ? { title: input.title } : {}),
          sessionId: hostSessionId,
        });
        const row = hostSessionId ? await attachPlanSession(created, hostSessionId) : created;
        return jsonResult({
          ...planSummary(row),
          document: row.document,
          templates: await listPlanTemplates(row),
        });
      }),
  );

  server.registerTool(
    PLAN_TOOL_NAMES.read,
    {
      title: 'Read a plan',
      description:
        'The current plan document and its revision. Call this at the start of every turn while a plan is active — the person may have edited the canvas directly since you last looked — and pass the revision you read to `plan_draft`.',
      inputSchema: { planId: planIdParam },
      outputSchema: {
        planId: z.string(),
        href: z.string(),
        title: z.string(),
        status: z.string(),
        revision: z.number().int(),
        counts: planCountsSchema,
        document: PlanDocument,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) =>
      runTool(async () => {
        const row = await loadOwnedPlan(ownerOf(ctx), input.planId);
        return jsonResult({ ...planSummary(row), document: row.document });
      }),
  );

  server.registerTool(
    PLAN_TOOL_NAMES.draft,
    {
      title: 'Draft on the canvas',
      description:
        'Change the plan document in one batch: add or update nodes (invent a short `ref` for each and name parents by ref; order does not matter), set fields, move a task to another project, remove a draft node, add or remove a dependency, or apply a template to a node. Write everything a turn produced in ONE call so it lands on the canvas together. The batch applies whole or not at all; a rejection names the operation and path. Nothing here reaches the workspace — nodes stay drafts until `plan_commit`. A node that has already been created cannot be edited here; use `update` on the real object instead.',
      inputSchema: {
        planId: planIdParam,
        revision: z
          .number()
          .int()
          .min(0)
          .describe(
            'The revision you last read. A stale revision is refused; read again and retry.',
          ),
        ops: z.array(PlanOp).min(1).max(200).describe('The batch, applied in order.'),
      },
      outputSchema: {
        planId: z.string(),
        revision: z.number().int().describe('The new revision to pass next time.'),
        counts: planCountsSchema,
        added: z.array(z.string()).describe('Refs this batch introduced.'),
        changed: z.array(z.string()).describe('Refs whose fields or place changed.'),
        removed: z.array(z.string()).describe('Refs this batch removed.'),
      },
      _meta: { ...PRIVATE_DRAFT_META },
      annotations: PRIVATE_DRAFT_ANNOTATIONS,
    },
    (input) =>
      runTool(async () => {
        const ownerUserId = ownerOf(ctx);
        const before = await loadOwnedPlan(ownerUserId, input.planId);
        const row = await patchPlan(ownerUserId, input.planId, {
          revision: input.revision,
          ops: input.ops,
        });
        return jsonResult({
          planId: row.id,
          revision: row.revision,
          counts: planCounts(row.document),
          ...describeChange(before.document, row.document),
        });
      }),
  );

  server.registerTool(
    PLAN_TOOL_NAMES.commit,
    {
      title: 'Confirm part of a plan',
      description:
        'Create the named draft nodes as real work in the workspace, in one transaction. Ancestors that are still drafts are included automatically, so naming a task also creates its project and initiative when those are drafts. Anything already there by that name in that place is matched instead of duplicated. Call this only for a part the person has settled in conversation, and say what it will create.',
      inputSchema: {
        planId: planIdParam,
        refs: z.array(z.string()).min(1).max(200).describe('The refs to confirm.'),
      },
      outputSchema: {
        planId: z.string(),
        revision: z.number().int(),
        status: z.string(),
        counts: planCountsSchema,
        placed: z.array(PlanPlaced).describe('Every node this commit touched, parents first.'),
        created: z.number().int(),
        matched: z.number().int(),
        changeSetId: z
          .string()
          .nullable()
          .describe('Pass to `undo` to take the whole commit back. Null when nothing was created.'),
      },
      _meta: widgetMeta(WIDGET.changeReport),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) =>
      runTool(async () => {
        const ownerUserId = ownerOf(ctx);
        const row = await loadOwnedPlan(ownerUserId, input.planId);
        if (row.status === 'archived') throw new NotFoundError('Plan not found');
        const actorCtx = await scopedActor(ctx, row.organizationId, 'work:write');
        await authorize(actorCtx, 'contribute', {
          kind: 'organization',
          id: row.organizationId,
          orgId: row.organizationId,
        });
        const result = await commitPlanNodes({
          row,
          refs: input.refs,
          actorId: actorCtx.actorId,
          origin: {
            tool: PLAN_TOOL_NAMES.commit,
            ...(sessionId ? { sessionId } : {}),
            ...(ctx.principal.kind === 'agent' ? { client: ctx.principal.displayName } : {}),
          },
        });
        const created = result.placed.filter((item) => item.created).length;
        return jsonResult({
          planId: result.row.id,
          revision: result.row.revision,
          status: result.row.status,
          counts: planCounts(result.row.document),
          placed: result.placed,
          created,
          matched: result.placed.length - created,
          changeSetId: result.changeSetId,
        });
      }),
  );
}

/** Which refs a batch added, changed, or removed, for the model's own bookkeeping. */
function describeChange(
  before: PlanDocument,
  after: PlanDocument,
): { added: string[]; changed: string[]; removed: string[] } {
  const previous = new Map(before.nodes.map((node) => [node.ref, JSON.stringify(node)]));
  const next = new Map(after.nodes.map((node) => [node.ref, JSON.stringify(node)]));
  const added: string[] = [];
  const changed: string[] = [];
  for (const [ref, serialized] of next) {
    const was = previous.get(ref);
    if (was === undefined) added.push(ref);
    else if (was !== serialized) changed.push(ref);
  }
  const removed = [...previous.keys()].filter((ref) => !next.has(ref));
  return { added, changed, removed };
}

/** Exported for the catalog's own tests: the kinds a plan node may take. */
export const PLAN_NODE_KINDS: readonly PlanNodeKind[] = PlanNodeKind.options;
