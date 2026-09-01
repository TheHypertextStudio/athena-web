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
    description: `Turn freeform \`text\` into a native {@link TaskOut} in one shot — the **default** path of the hybrid Home prompt box, designed so a user can dump a thought without picking a team, state, or assignee. Its sibling escalation, "ask Athena to plan", lives at \`POST /v1/orgs/:orgId/sessions\` and invokes an agent; capture deliberately does NOT — it is a plain, deterministic task create, the same write a direct task POST performs.

Behavior: the task title is derived from the text (first non-empty line, inner whitespace collapsed, capped at 120 chars with an ellipsis) while the full text is kept as the task description, so a long paste keeps a clean title without losing detail. The task lands on the org's **default team** (the oldest active team, seeded at org-create) in that team's first workflow state (its entry/backlog column, or a neutral \`backlog\` for a stateless team), is assigned to the caller, and — when the team has a date-covering window — is attached to the current cycle (otherwise left uncommitted; capture never blocks on cycle availability). \`provenance.source\` is \`native\`.

Errors: 404 (\`No team to capture into\`) when the org has no team to land in. Requires \`contribute\` — the same bar as creating a task directly. Side effect: the new task enters the org's work layer and emits activity like any other task create. Related: \`POST /v1/orgs/:orgId/sessions\` (escalate the same prompt to an agent), and the Tasks routes for full task control.`,
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
