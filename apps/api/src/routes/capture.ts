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
import { actor, db, task, team } from '@docket/db';
import { CaptureBody, TaskOut } from '@docket/types';
import { and, asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { z } from 'zod';

import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { resolveCurrentCycleId } from '../lib/current-cycle';
import { ok } from '../lib/ok';
import { zJson } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';

type TaskRow = typeof task.$inferSelect;

/** The maximum length of a capture-derived task title (the rest stays in the body). */
const TITLE_MAX = 120;

/**
 * Derive a task title from freeform capture text.
 *
 * @remarks
 * Uses the first non-empty line (so a multi-line paste keeps a clean title), collapses
 * inner whitespace, and caps the length at {@link TITLE_MAX} with an ellipsis so a long
 * one-liner still produces a readable title. The full text remains available as the
 * task description for longer captures.
 *
 * @param text - The raw captured text (already validated non-empty).
 * @returns a trimmed, length-capped single-line title.
 */
function deriveTitle(text: string): string {
  const firstLine = text.split('\n').find((line) => line.trim().length > 0) ?? text;
  const collapsed = firstLine.trim().replace(/\s+/g, ' ');
  return collapsed.length > TITLE_MAX
    ? `${collapsed.slice(0, TITLE_MAX - 1).trimEnd()}…`
    : collapsed;
}

/** Project an active task row into the {@link TaskOut} wire shape. */
function toOut(t: TaskRow): z.input<typeof TaskOut> {
  return {
    id: t.id,
    organizationId: t.organizationId,
    title: t.title,
    description: t.description,
    teamId: t.teamId,
    state: t.state,
    priority: t.priority,
    assigneeId: t.assigneeId,
    delegateId: t.delegateId,
    projectId: t.projectId,
    programId: t.programId,
    estimateMinutes: t.estimateMinutes,
    dueDate: t.dueDate?.toISOString() ?? null,
    provenance: {
      source: t.source,
      sourceIntegrationId: t.sourceIntegrationId,
      externalId: t.externalId,
      externalUrl: t.externalUrl,
      syncMode: t.sourceSyncMode,
    },
    createdAt: t.createdAt.toISOString(),
  };
}

/** Quick-capture router: turn freeform text into an assigned, cycle-attached task. */
const capture = new Hono<AppEnv>().post(
  '/',
  capabilityGuard('contribute'),
  zJson(CaptureBody),
  async (c) => {
    const { orgId, actorId } = c.get('actorCtx');
    const { text } = c.req.valid('json');

    // Capture lands on the org's default team (the oldest active team — the one seeded at
    // org-create). The whole capture surface is team-agnostic by design: the user types
    // freeform text, not a team picker, so we resolve the canonical landing team here.
    const teamRows = await db
      .select({ id: team.id, workflowStates: team.workflowStates })
      .from(team)
      .where(eq(team.organizationId, orgId))
      .orderBy(asc(team.createdAt))
      .limit(1);
    const teamRow = teamRows[0];
    if (!teamRow) throw new NotFoundError('No team to capture into');

    // The caller must be a real actor in the org to be the assignee (the actor context
    // already proved membership; this guards a stale/cross-tenant id defensively).
    const assigneeRows = await db
      .select({ id: actor.id })
      .from(actor)
      .where(and(eq(actor.id, actorId), eq(actor.organizationId, orgId)))
      .limit(1);
    const assigneeId = assigneeRows[0]?.id ?? null;

    // Attach to the live cycle when the team has a date-covering window; otherwise leave
    // the task uncommitted (null) — capture never blocks on cycle availability.
    const cycleId = await resolveCurrentCycleId(orgId, teamRow.id);

    // A capture lands in the team's first workflow state (its entry/backlog column), or a
    // neutral `backlog` for a stateless team — mirroring the task-create fallback.
    const state = teamRow.workflowStates[0]?.key ?? 'backlog';

    const inserted = await db
      .insert(task)
      .values({
        organizationId: orgId,
        title: deriveTitle(text),
        description: text,
        teamId: teamRow.id,
        state,
        assigneeId,
        cycleId,
        source: 'native',
        createdBy: actorId,
      })
      .returning();
    const row = inserted[0];
    /* v8 ignore next -- @preserve defensive: insert always returns a row */
    if (!row) throw new Error('capture task insert returned no row');
    return ok(c, TaskOut, toOut(row));
  },
);

export default capture;
