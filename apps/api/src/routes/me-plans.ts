/**
 * `@docket/api` — personal plan drafts (mounted at `/v1/me/plans`).
 *
 * @remarks
 * The planning canvas's own API. A plan is personal: every route here is keyed only by the
 * authenticated user, and a workspace is named on a plan rather than used to authorize it. The
 * one exception is confirming nodes into real objects, which resolves the owner's actor in the
 * plan's workspace and requires `contribute` there at the moment of the write.
 */
import {
  PlanCommitBody,
  PlanCommitOut,
  PlanDraftCreate,
  PlanDraftListOut,
  PlanDraftOut,
  PlanDraftPatch,
  PlanRoster,
} from '@docket/work/plan-draft-contract';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { AuthError } from '../error';
import { created, ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { commitOwnedPlan } from '../lib/plan-draft/commit';
import {
  archivePlan,
  createOrReopenPlan,
  listOwnedPlans,
  listPlanRoster,
  loadOwnedPlan,
  patchPlan,
  presentPlan,
} from '../lib/plan-draft/store';
import { zJson, zParam } from '../lib/validate';

/** Return the authenticated owner or fail closed. */
function requestOwner(c: { get(key: 'session'): AppEnv['Variables']['session'] }): string {
  const owner = c.get('session')?.user.id;
  if (!owner) throw new AuthError();
  return owner;
}

const idParam = z.object({ id: z.string() });

const mePlans = new Hono<AppEnv>()
  .get(
    '/',
    apiDoc({
      tag: 'Me',
      summary: 'List plans',
      response: PlanDraftListOut,
      description: `List the caller's planning drafts that are not archived, most recently edited first. A plan is a personal, durable document built on the planning canvas with Athena: an initiative at the root, projects under it, and tasks inside them, each node either still a draft or already confirmed into a real object. Session-only. **401** when unauthenticated. Returns {@link PlanDraftListOut}.`,
    }),
    async (c) => {
      const owner = requestOwner(c);
      const rows = await listOwnedPlans(owner);
      return ok(c, PlanDraftListOut, { items: await Promise.all(rows.map(presentPlan)) });
    },
  )
  .post(
    '/',
    apiDoc({
      status: 201,
      tag: 'Me',
      summary: 'Start a plan',
      response: PlanDraftOut,
      description: `Start a planning draft in a workspace the caller belongs to, or reopen the caller's active draft rooted on the same initiative when \`initiativeId\` names one that already has a plan. A rooted plan starts with that initiative as a confirmed root node; an unrooted plan starts empty. **404** when the caller is not a member of \`organizationId\` or the initiative is not in it. Returns the {@link PlanDraftOut}, with **201** even when an existing plan was reopened.`,
    }),
    zJson(PlanDraftCreate),
    async (c) => {
      const owner = requestOwner(c);
      const row = await createOrReopenPlan(owner, c.req.valid('json'));
      return created(c, PlanDraftOut, await presentPlan(row));
    },
  )
  .get(
    '/:id',
    apiDoc({
      tag: 'Me',
      summary: 'Get a plan',
      response: PlanDraftOut,
      description: `Read one of the caller's plans with its full document and current \`revision\`. Confirmed nodes are hydrated under \`objects\`, keyed by node ref, with the live name, status, health, link, and archived flag of the real record. **404** for an unknown id or another user's plan. Returns {@link PlanDraftOut}.`,
    }),
    zParam(idParam),
    async (c) => {
      const owner = requestOwner(c);
      const row = await loadOwnedPlan(owner, c.req.valid('param').id);
      return ok(c, PlanDraftOut, await presentPlan(row));
    },
  )
  .get(
    '/:id/roster',
    apiDoc({
      tag: 'Me',
      summary: 'List who a plan may assign',
      response: PlanRoster,
      description: `The people and teams in the plan's workspace that its nodes may be assigned to. \`people\` are the workspace's active members, each with the \`teamIds\` they belong to; \`teams\` are its live teams. Use an \`actorId\` as a node's \`assigneeId\`, \`leadId\`, or \`ownerId\`, and a team \`id\` as its \`teamId\`. **404** for an unknown or foreign plan. Returns {@link PlanRoster}.`,
    }),
    zParam(idParam),
    async (c) => {
      const owner = requestOwner(c);
      const row = await loadOwnedPlan(owner, c.req.valid('param').id);
      return ok(c, PlanRoster, await listPlanRoster(row));
    },
  )
  .patch(
    '/:id',
    apiDoc({
      tag: 'Me',
      summary: 'Edit a plan',
      response: PlanDraftOut,
      description: `Apply a batch of operations to the plan document against the \`revision\` the batch was written for. The batch applies whole or not at all. **412** (\`precondition_failed\`) when the plan has moved past that revision — re-read the plan and replay the batch. **422** when an operation is invalid; \`fieldErrors\` names the operation and path, for example \`ops.2.parentRef\`. **404** for an unknown, archived, or foreign plan. Returns the updated {@link PlanDraftOut}.`,
    }),
    zParam(idParam),
    zJson(PlanDraftPatch),
    async (c) => {
      const owner = requestOwner(c);
      const row = await patchPlan(owner, c.req.valid('param').id, c.req.valid('json'));
      return ok(c, PlanDraftOut, await presentPlan(row));
    },
  )
  .post(
    '/:id/commit',
    apiDoc({
      tag: 'Me',
      summary: 'Confirm plan nodes',
      response: PlanCommitOut,
      description: `Create the named draft nodes as real objects in the plan's workspace, in one transaction. Unconfirmed ancestors are included automatically so a task never lands without its project, and a task filed under another task is created as its subtask in the same project. Nodes that already exist by name in the same place are matched rather than duplicated. Requires \`contribute\` in the plan's workspace at the moment of the call; **403** otherwise, **404** when the caller is no longer a member. Returns {@link PlanCommitOut} with the updated plan, what each node became, \`createdCounts\` for the confirmation line, and the change set id to pass to \`POST /v1/me/athena/changes/{changeSetId}/undo\`.`,
    }),
    zParam(idParam),
    zJson(PlanCommitBody),
    async (c) => {
      const owner = requestOwner(c);
      const result = await commitOwnedPlan(
        owner,
        c.req.valid('param').id,
        c.req.valid('json').refs,
      );
      return ok(c, PlanCommitOut, {
        plan: await presentPlan(result.row),
        placed: result.placed,
        createdCounts: result.createdCounts,
        changeSetId: result.changeSetId,
      });
    },
  )
  .post(
    '/:id/archive',
    apiDoc({
      tag: 'Me',
      summary: 'Archive a plan',
      response: PlanDraftOut,
      description: `Archive a plan without creating anything. Nodes already confirmed stay in the workspace; draft nodes are kept on the archived document for reference. Idempotent. **404** for an unknown or foreign plan. Returns the archived {@link PlanDraftOut}.`,
    }),
    zParam(idParam),
    async (c) => {
      const owner = requestOwner(c);
      const row = await archivePlan(owner, c.req.valid('param').id);
      return ok(c, PlanDraftOut, await presentPlan(row));
    },
  );

export default mePlans;
