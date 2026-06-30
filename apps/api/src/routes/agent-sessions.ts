/** `@docket/api` — agent-sessions router (mounted at `/v1/orgs/:orgId/sessions`). */
import { agentSession, db, sessionActivity } from '@docket/db';
import {
  AgentSessionDetailOut,
  AgentSessionOut,
  pageOf,
  SessionActivityOut,
  SessionFromPromptBody,
  SessionReplyBody,
} from '@docket/types';
import { and, asc, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc, describeRoute } from '../lib/openapi-route';
import { zJson, zParam, zQuery } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';

import {
  activityParam,
  idParam,
  listQuery,
  loadSession,
  toActivityOut,
  toSessionOut,
  transitionLifecycle,
} from './agent-session-helpers';
import { createAndRunFromPrompt, runSession } from './agent-session-runner';
import { decideActivity, replyToElicitation, resolveAction } from './agent-session-approval';

/** Agent-sessions router: list (status filter), read with stream, approve + reject. */
const agentSessions = new Hono<AppEnv>()
  .get(
    '/',
    apiDoc({ tag: 'Agents', summary: 'List agent sessions', response: pageOf(AgentSessionOut) }),
    zQuery(listQuery),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { status } = c.req.valid('query');
      const where = status
        ? and(eq(agentSession.organizationId, orgId), eq(agentSession.status, status))
        : eq(agentSession.organizationId, orgId);
      const rows = await db
        .select()
        .from(agentSession)
        .where(where)
        .orderBy(desc(agentSession.createdAt));
      return ok(c, pageOf(AgentSessionOut), { items: rows.map(toSessionOut) });
    },
  )
  .post(
    '/',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Agents',
      summary: 'Start an agent session from a prompt',
      capability: 'contribute',
      response: AgentSessionOut,
    }),
    zJson(SessionFromPromptBody),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { prompt, agentId } = c.req.valid('json');
      const settled = await createAndRunFromPrompt(orgId, actorId, prompt, agentId);
      return ok(c, AgentSessionOut, toSessionOut(settled));
    },
  )
  .get(
    '/:id',
    apiDoc({ tag: 'Agents', summary: 'Get an agent session', response: AgentSessionDetailOut }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const rows = await db
        .select()
        .from(agentSession)
        .where(and(eq(agentSession.id, id), eq(agentSession.organizationId, orgId)))
        .limit(1);
      const row = rows[0];
      if (!row) throw new NotFoundError('Session not found');
      const activities = await db
        .select()
        .from(sessionActivity)
        .where(eq(sessionActivity.sessionId, id))
        .orderBy(asc(sessionActivity.createdAt));
      return ok(c, AgentSessionDetailOut, {
        ...toSessionOut(row),
        activities: activities.map(toActivityOut),
      });
    },
  )
  .post(
    '/:id/run',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Agents',
      summary: 'Run an agent session',
      capability: 'contribute',
      response: AgentSessionOut,
    }),
    zParam(idParam),
    zJson(z.object({})),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const settled = await runSession(orgId, id);
      return ok(c, AgentSessionOut, toSessionOut(settled));
    },
  )
  .get(
    '/:id/stream',
    describeRoute({ tags: ['Agents'], summary: 'Stream agent session activity (SSE)' }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const sessionRows = await db
        .select()
        .from(agentSession)
        .where(and(eq(agentSession.id, id), eq(agentSession.organizationId, orgId)))
        .limit(1);
      if (!sessionRows[0]) throw new NotFoundError('Session not found');
      const activities = await db
        .select()
        .from(sessionActivity)
        .where(eq(sessionActivity.sessionId, id))
        .orderBy(asc(sessionActivity.createdAt));
      return streamSSE(c, async (stream) => {
        for (const activity of activities) {
          await stream.writeSSE({
            id: activity.id,
            event: activity.type,
            data: JSON.stringify(toActivityOut(activity)),
          });
        }
      });
    },
  )
  .get(
    '/:id/activity',
    apiDoc({
      tag: 'Agents',
      summary: 'List agent session activity',
      response: pageOf(SessionActivityOut),
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      await loadSession(orgId, id);
      const activities = await db
        .select()
        .from(sessionActivity)
        .where(eq(sessionActivity.sessionId, id))
        .orderBy(asc(sessionActivity.createdAt));
      return ok(c, pageOf(SessionActivityOut), { items: activities.map(toActivityOut) });
    },
  )
  .post(
    '/:id/activity/:activityId/approve',
    capabilityGuard('assign'),
    apiDoc({
      tag: 'Agents',
      summary: 'Approve a gated session activity',
      capability: 'assign',
      response: SessionActivityOut,
    }),
    zParam(activityParam),
    zJson(z.object({ scope: z.enum(['this', 'all_in_session']).optional() }).optional()),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id, activityId } = c.req.valid('param');
      const body = c.req.valid('json');
      const updated = await decideActivity(orgId, actorId, id, activityId, {
        decision: 'approve',
        ...(body?.scope ? { scope: body.scope } : {}),
      });
      return ok(c, SessionActivityOut, toActivityOut(updated));
    },
  )
  .post(
    '/:id/activity/:activityId/reject',
    capabilityGuard('assign'),
    apiDoc({
      tag: 'Agents',
      summary: 'Reject a gated session activity',
      capability: 'assign',
      response: SessionActivityOut,
    }),
    zParam(activityParam),
    zJson(z.object({ scope: z.enum(['this', 'all_in_session']).optional() }).optional()),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id, activityId } = c.req.valid('param');
      const body = c.req.valid('json');
      const updated = await decideActivity(orgId, actorId, id, activityId, {
        decision: 'reject',
        ...(body?.scope ? { scope: body.scope } : {}),
      });
      return ok(c, SessionActivityOut, toActivityOut(updated));
    },
  )
  .post(
    '/:id/activity/:activityId/reply',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Agents',
      summary: 'Reply to a session elicitation',
      capability: 'contribute',
      response: SessionActivityOut,
    }),
    zParam(activityParam),
    zJson(SessionReplyBody),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id, activityId } = c.req.valid('param');
      const body = c.req.valid('json');
      const created = await replyToElicitation(orgId, id, activityId, body.body);
      return ok(c, SessionActivityOut, toActivityOut(created));
    },
  )
  .post(
    '/:id/pause',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Agents',
      summary: 'Pause an agent session',
      capability: 'contribute',
      response: AgentSessionOut,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const updated = await transitionLifecycle(orgId, id, 'pause');
      return ok(c, AgentSessionOut, toSessionOut(updated));
    },
  )
  .post(
    '/:id/resume',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Agents',
      summary: 'Resume an agent session',
      capability: 'contribute',
      response: AgentSessionOut,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const updated = await transitionLifecycle(orgId, id, 'resume');
      return ok(c, AgentSessionOut, toSessionOut(updated));
    },
  )
  .post(
    '/:id/cancel',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Agents',
      summary: 'Cancel an agent session',
      capability: 'contribute',
      response: AgentSessionOut,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const updated = await transitionLifecycle(orgId, id, 'cancel');
      return ok(c, AgentSessionOut, toSessionOut(updated));
    },
  )
  .post(
    // Approving/rejecting an agent's proposed write is an `assign`-level act (permissions
    // §9.3; api-rpc-contract `POST /:sessionId/approvals/:activityId` → org:assign), the
    // same bar as the activity-scoped approval routes above. A contribute-only actor must
    // not clear an agent's gated action via this legacy session-level shortcut.
    '/:id/approve',
    capabilityGuard('assign'),
    apiDoc({
      tag: 'Agents',
      summary: 'Approve a session-level proposed action',
      capability: 'assign',
      response: AgentSessionOut,
    }),
    zParam(idParam),
    zJson(z.object({})),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const updated = await resolveAction(orgId, id, 'approved');
      return ok(c, AgentSessionOut, toSessionOut(updated));
    },
  )
  .post(
    // See `/:id/approve`: rejecting a proposed action is likewise an `assign`-level act.
    '/:id/reject',
    capabilityGuard('assign'),
    apiDoc({
      tag: 'Agents',
      summary: 'Reject a session-level proposed action',
      capability: 'assign',
      response: AgentSessionOut,
    }),
    zParam(idParam),
    zJson(z.object({})),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const updated = await resolveAction(orgId, id, 'rejected');
      return ok(c, AgentSessionOut, toSessionOut(updated));
    },
  );

export default agentSessions;
