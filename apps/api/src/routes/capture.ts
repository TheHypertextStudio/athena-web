/**
 * `@docket/api` — quick-capture router (mounted at `/v1/orgs/:orgId/capture`).
 *
 * @remarks
 * The default path of the hybrid Home prompt box (DECISION: quick-capture by default,
 * with a separate "ask Athena to plan" escalation that lives on the sessions router).
 * `POST /` turns freeform `text` into a native {@link task}: the title is derived from
 * the text (first line, trimmed + length-capped), the caller is the assignee, the task
 * lands on the org's default team in that team's first workflow state, and — when the
 * team has a date-covering window — it is attached to the current cycle. No agent is
 * invoked; escalation is the explicit sessions path. `contribute` is required (same bar
 * as a direct task create).
 */
import { db, task } from '@docket/db';
import { CaptureBody } from '@docket/athena/agent-contract';
import { TaskOut } from '@docket/work/task-model';
import { Hono } from 'hono';

import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { deriveCaptureTitle } from '../lib/capture-title';
import { resolveLandingTarget } from '../lib/task-landing';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';
import { enqueueSearchUpsert } from '../search/write-through';

import { toOut as taskToOut } from './task-helpers';

/** Quick-capture router: turn freeform text into an assigned, cycle-attached task. */
const capture = new Hono<AppEnv>().post(
  '/',
  capabilityGuard('contribute'),
  apiDoc({
    tag: 'Capture',
    summary: 'Quick-capture text into a task',
    capability: 'contribute',
    response: TaskOut,
    description: `Create a task from freeform \`text\` without asking the caller to choose a team, state, or assignee. Docket uses the first non-empty line as the title, collapses repeated whitespace, and truncates the title to 120 characters. The complete input remains in the task description.

The task is assigned to the caller and placed in the organization's oldest active team, using that team's first workflow state. When the team has a cycle that covers today, the task joins that cycle; otherwise it remains outside a cycle. The task has \`provenance.source: "native"\` and appears in organization activity. Docket returns 404 when the organization has no active team. Use \`POST /v1/orgs/:orgId/sessions\` when Athena should interpret or plan the text instead.`,
  }),
  zJson(CaptureBody),
  async (c) => {
    const { orgId, actorId } = c.get('actorCtx');
    const { text } = c.req.valid('json');

    // Capture is team-agnostic (the user types freeform text, not a team picker), so the
    // canonical landing target — oldest team, its first workflow state, the caller as assignee,
    // the current cycle — is resolved by the shared resolver (also used by suggestion-accept).
    const landing = await resolveLandingTarget(orgId, actorId);
    if (!landing) throw new NotFoundError('No team to capture into');

    const inserted = await db
      .insert(task)
      .values({
        organizationId: orgId,
        title: deriveCaptureTitle(text),
        description: text,
        teamId: landing.teamId,
        statusId: landing.statusId,
        state: landing.state,
        assigneeId: landing.assigneeId,
        cycleId: landing.cycleId,
        source: 'native',
        createdBy: actorId,
      })
      .returning();
    const row = inserted[0];
    /* v8 ignore next -- @preserve defensive: insert always returns a row */
    if (!row) throw new Error('capture task insert returned no row');
    await enqueueSearchUpsert(orgId, 'task', row.id);
    return ok(c, TaskOut, taskToOut(row, []));
  },
);

export default capture;
