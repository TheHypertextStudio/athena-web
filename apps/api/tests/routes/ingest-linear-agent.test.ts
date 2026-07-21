import { createHmac } from 'node:crypto';
import { resolve } from 'node:path';

import { migrate } from 'drizzle-orm/pglite/migrator';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type * as DbModule from '@docket/db';
import type * as IntegrationsModule from '@docket/integrations';
import type * as ContainerModule from '../../src/container';
import type ingestLinearAgentRouter from '../../src/routes/ingest-linear-agent';
import type { sealCredential as SealCredential } from '../../src/lib/credentials';

const { buildLinearAgentClient } = vi.hoisted(() => ({
  buildLinearAgentClient: vi.fn(),
}));

vi.mock('../../src/container', async (importOriginal) => ({
  ...(await importOriginal<typeof ContainerModule>()),
  buildLinearAgentClient,
}));

vi.hoisted(() => {
  process.env['DATABASE_URL'] = 'pglite://memory://';
  process.env['APP_MODE'] = 'test';
  process.env['NODE_ENV'] = 'test';
  process.env['BETTER_AUTH_SECRET'] = 'test-secret-test-secret-test-secret-0123456789';
  process.env['BETTER_AUTH_TRUSTED_ORIGINS'] = 'https://docket.localhost';
  process.env['CRON_SECRET'] = 'test-cron-secret';
  process.env['SKIP_ENV_VALIDATION'] = '1';
  process.env['AGENT_MAX_TURNS'] = '8';
  process.env['API_URL'] = 'https://api.docket.test';
  process.env['CREDENTIALS_ENCRYPTION_KEY'] = Buffer.from('0'.repeat(32)).toString('base64');
  process.env['LINEAR_AGENT_CLIENT_ID'] = 'agent-client-id';
  process.env['LINEAR_AGENT_CLIENT_SECRET'] = 'agent-client-secret';
  process.env['LINEAR_AGENT_WEBHOOK_SECRET'] = 'agent-webhook-secret';
});

const MIGRATIONS = resolve(import.meta.dirname, '../../../../packages/db/drizzle');
const WEBHOOK_SECRET = 'agent-webhook-secret';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let ingestLinearAgent!: typeof ingestLinearAgentRouter;
let sealCredential!: typeof SealCredential;
let MockLinearAgent!: typeof IntegrationsModule.MockLinearAgent;

beforeAll(async () => {
  schema = await import('@docket/db');
  db = schema.db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  ingestLinearAgent = (await import('../../src/routes/ingest-linear-agent')).default;
  ({ sealCredential } = await import('../../src/lib/credentials'));
  ({ MockLinearAgent } = await import('@docket/integrations'));
});

afterEach(() => {
  buildLinearAgentClient.mockReset();
});

/** Sign a body the way Linear's Agent platform does: HMAC-SHA256(secret, rawBody). */
function signed(body: Record<string, unknown>): {
  headers: Record<string, string>;
  rawBody: string;
} {
  const payload = { webhookTimestamp: Date.now(), ...body };
  const rawBody = JSON.stringify(payload);
  const signature = createHmac('sha256', WEBHOOK_SECRET).update(rawBody, 'utf8').digest('hex');
  return {
    headers: { 'content-type': 'application/json', 'linear-signature': signature },
    rawBody,
  };
}

/** Seed an org with a connected `linear_agent` integration (and, by default, its credential). */
async function seedOrgWithLinearAgent(
  opts: { withCredential?: boolean } = {},
): Promise<{ orgId: string; humanActorId: string; integrationId: string; workspaceId: string }> {
  const slug = `lia-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  const orgId = org!.id;
  const [human] = await db
    .insert(schema.actor)
    .values({ organizationId: orgId, kind: 'human', displayName: 'Ada' })
    .returning({ id: schema.actor.id });
  const humanActorId = human!.id;
  const workspaceId = `ws_${Math.random().toString(36).slice(2, 8)}`;
  const [intg] = await db
    .insert(schema.integration)
    .values({
      organizationId: orgId,
      provider: 'linear_agent',
      pattern: 'agent',
      roles: [],
      connection: { externalWorkspaceId: workspaceId },
      status: 'connected',
      createdBy: humanActorId,
    })
    .returning({ id: schema.integration.id });
  const integrationId = intg!.id;
  if (opts.withCredential !== false) {
    await db.insert(schema.integrationCredential).values({
      organizationId: orgId,
      integrationId,
      ciphertext: sealCredential(JSON.stringify({ accessToken: 'tok' })),
    });
  }
  return { orgId, humanActorId, integrationId, workspaceId };
}

/** Link a Linear external id to a fresh Docket actor in `orgId` via a Better Auth `account`. */
async function seedLinkedLinearActor(orgId: string, externalId: string): Promise<string> {
  const [u] = await db
    .insert(schema.user)
    .values({ name: 'Linear User', email: `${externalId}@example.test` })
    .returning({ id: schema.user.id });
  const userId = u!.id;
  await db.insert(schema.hub).values({ userId });
  await db.insert(schema.account).values({ userId, providerId: 'linear', accountId: externalId });
  const [a] = await db
    .insert(schema.actor)
    .values({
      organizationId: orgId,
      kind: 'human',
      displayName: 'Linear User',
      userId,
      status: 'active',
    })
    .returning({ id: schema.actor.id });
  return a!.id;
}

describe('POST /internal/ingest/linear-agent', () => {
  it('400s an invalid signature before any write', async () => {
    const seeded = await seedOrgWithLinearAgent();
    const res = await ingestLinearAgent.request('/linear-agent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'linear-signature': 'not-a-real-signature' },
      body: JSON.stringify({
        action: 'created',
        webhookTimestamp: Date.now(),
        organizationId: seeded.workspaceId,
        agentSession: { id: 'las_bad_sig' },
      }),
    });
    expect(res.status).toBe(400);
    const rows = await db
      .select()
      .from(schema.agentSession)
      .where(eq(schema.agentSession.externalRunRef, 'linear-agent-session:las_bad_sig'));
    expect(rows).toHaveLength(0);
  });

  it('acknowledges an event for an unknown workspace as unrouted (200, no writes)', async () => {
    const { headers, rawBody } = signed({
      action: 'created',
      organizationId: 'ws_unknown',
      agentSession: { id: 'las_unrouted' },
    });
    const res = await ingestLinearAgent.request('/linear-agent', {
      method: 'POST',
      headers,
      body: rawBody,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, processed: false });
    const rows = await db
      .select()
      .from(schema.agentSession)
      .where(eq(schema.agentSession.externalRunRef, 'linear-agent-session:las_unrouted'));
    expect(rows).toHaveLength(0);
  });

  it('acknowledges an event for an integration with no completed credential (200, no writes)', async () => {
    const seeded = await seedOrgWithLinearAgent({ withCredential: false });
    const { headers, rawBody } = signed({
      action: 'created',
      organizationId: seeded.workspaceId,
      agentSession: { id: 'las_nocred' },
    });
    const res = await ingestLinearAgent.request('/linear-agent', {
      method: 'POST',
      headers,
      body: rawBody,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, processed: false });
    const rows = await db
      .select()
      .from(schema.agentSession)
      .where(eq(schema.agentSession.externalRunRef, 'linear-agent-session:las_nocred'));
    expect(rows).toHaveLength(0);
  });

  describe('action: created', () => {
    it('creates a session + external link, calls agentSessionUpdate, and queues a run', async () => {
      const seeded = await seedOrgWithLinearAgent();
      const linearActorId = await seedLinkedLinearActor(seeded.orgId, 'linear_user_1');
      const port = new MockLinearAgent();
      buildLinearAgentClient.mockReturnValue(port);

      const { headers, rawBody } = signed({
        action: 'created',
        organizationId: seeded.workspaceId,
        agentSession: { id: 'las_1' },
        actor: { id: 'linear_user_1', type: 'user' },
      });

      const res = await ingestLinearAgent.request('/linear-agent', {
        method: 'POST',
        headers,
        body: rawBody,
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as {
        received: boolean;
        processed: boolean;
        sessionId?: string;
      };
      expect(json).toEqual({ received: true, processed: true, sessionId: expect.any(String) });
      const sessionId = json.sessionId!;

      const [session] = await db
        .select()
        .from(schema.agentSession)
        .where(eq(schema.agentSession.id, sessionId));
      expect(session?.organizationId).toBe(seeded.orgId);
      expect(session?.status).toBe('pending');
      expect(session?.trigger).toBe('mention');
      expect(session?.initiatorId).toBe(linearActorId);
      expect(session?.externalRunRef).toBe('linear-agent-session:las_1');

      const [link] = await db
        .select()
        .from(schema.agentSessionExternalLink)
        .where(eq(schema.agentSessionExternalLink.sessionId, sessionId));
      expect(link?.provider).toBe('linear');
      expect(link?.externalSessionId).toBe('las_1');
      expect(link?.externalWorkspaceId).toBe(seeded.workspaceId);
      expect(link?.externalIssueId).toBeNull();

      const activities = await db
        .select()
        .from(schema.sessionActivity)
        .where(eq(schema.sessionActivity.sessionId, sessionId));
      expect(activities.some((a) => a.type === 'response')).toBe(true);
      expect(activities.some((a) => a.type === 'elicitation')).toBe(false);

      const runs = await db
        .select()
        .from(schema.agentSessionRun)
        .where(eq(schema.agentSessionRun.sessionId, sessionId));
      expect(runs).toHaveLength(1);
      expect(runs[0]?.status).toBe('queued');
      expect(runs[0]?.generation).toBe(0);

      expect(port.sessionUpdateLog).toHaveLength(1);
      expect(port.sessionUpdateLog[0]).toEqual({
        agentSessionId: 'las_1',
        externalUrls: [
          {
            label: 'Open in Docket',
            url: `https://docket.localhost/orgs/${seeded.orgId}/sessions/${sessionId}`,
          },
        ],
      });
    });

    it('creates an awaiting_input session with an elicitation activity when identity is unresolved, and queues no run', async () => {
      const seeded = await seedOrgWithLinearAgent();
      const port = new MockLinearAgent();
      buildLinearAgentClient.mockReturnValue(port);

      const { headers, rawBody } = signed({
        action: 'created',
        organizationId: seeded.workspaceId,
        agentSession: { id: 'las_unresolved' },
        actor: { id: 'linear_user_unknown' },
      });

      const res = await ingestLinearAgent.request('/linear-agent', {
        method: 'POST',
        headers,
        body: rawBody,
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as { sessionId?: string };
      const sessionId = json.sessionId!;

      const [session] = await db
        .select()
        .from(schema.agentSession)
        .where(eq(schema.agentSession.id, sessionId));
      expect(session?.status).toBe('awaiting_input');
      expect(session?.initiatorId).toBeNull();

      const activities = await db
        .select()
        .from(schema.sessionActivity)
        .where(eq(schema.sessionActivity.sessionId, sessionId));
      expect(activities.some((a) => a.type === 'elicitation')).toBe(true);

      const runs = await db
        .select()
        .from(schema.agentSessionRun)
        .where(eq(schema.agentSessionRun.sessionId, sessionId));
      expect(runs).toHaveLength(0);

      // The 10-second external-URL SLA is still honored even though identity is unresolved.
      expect(port.sessionUpdateLog).toHaveLength(1);
    });

    it('treats an entirely absent actor as unresolved (no crash, awaiting_input)', async () => {
      const seeded = await seedOrgWithLinearAgent();
      const port = new MockLinearAgent();
      buildLinearAgentClient.mockReturnValue(port);

      const { headers, rawBody } = signed({
        action: 'created',
        organizationId: seeded.workspaceId,
        agentSession: { id: 'las_no_actor' },
      });

      const res = await ingestLinearAgent.request('/linear-agent', {
        method: 'POST',
        headers,
        body: rawBody,
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as { sessionId?: string };
      const [session] = await db
        .select()
        .from(schema.agentSession)
        .where(eq(schema.agentSession.id, json.sessionId!));
      expect(session?.status).toBe('awaiting_input');
    });

    it("resolves the mentioned issue to a mirrored task via the org's regular linear connector", async () => {
      const seeded = await seedOrgWithLinearAgent();
      const linearActorId = await seedLinkedLinearActor(seeded.orgId, 'linear_user_task');
      const port = new MockLinearAgent();
      buildLinearAgentClient.mockReturnValue(port);

      // The REGULAR `provider: 'linear'` data-sync connector — a different integration row from
      // the `linear_agent` one seeded above.
      const [regularConnector] = await db
        .insert(schema.integration)
        .values({
          organizationId: seeded.orgId,
          provider: 'linear',
          pattern: 'connector',
          roles: ['work'],
          connection: { externalWorkspaceId: seeded.workspaceId },
          status: 'connected',
          createdBy: linearActorId,
        })
        .returning({ id: schema.integration.id });
      const [team] = await db
        .insert(schema.team)
        .values({ organizationId: seeded.orgId, name: 'Core', key: 'COR' })
        .returning({ id: schema.team.id });
      const [mirroredTask] = await db
        .insert(schema.task)
        .values({
          organizationId: seeded.orgId,
          title: 'Fix the thing',
          teamId: team!.id,
          state: 'backlog',
          source: 'linked',
          sourceIntegrationId: regularConnector!.id,
          externalId: 'issue_42',
        })
        .returning({ id: schema.task.id });

      // Linear's payload nests `issue` under `agentSession`, per `linear-agent.ts`'s docs.
      const { headers, rawBody } = signed({
        action: 'created',
        organizationId: seeded.workspaceId,
        agentSession: { id: 'las_with_issue', issue: { id: 'issue_42', title: 'Fix the thing' } },
        actor: { id: 'linear_user_task' },
      });

      const res = await ingestLinearAgent.request('/linear-agent', {
        method: 'POST',
        headers,
        body: rawBody,
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as { sessionId?: string };
      const [session] = await db
        .select()
        .from(schema.agentSession)
        .where(eq(schema.agentSession.id, json.sessionId!));
      expect(session?.taskId).toBe(mirroredTask!.id);

      const [link] = await db
        .select()
        .from(schema.agentSessionExternalLink)
        .where(eq(schema.agentSessionExternalLink.sessionId, json.sessionId!));
      expect(link?.externalIssueId).toBe('issue_42');
    });

    it('is idempotent against a retried delivery (no duplicate rows), but still re-issues agentSessionUpdate', async () => {
      const seeded = await seedOrgWithLinearAgent();
      await seedLinkedLinearActor(seeded.orgId, 'linear_user_dup');
      const port = new MockLinearAgent();
      buildLinearAgentClient.mockReturnValue(port);

      const { headers, rawBody } = signed({
        action: 'created',
        organizationId: seeded.workspaceId,
        agentSession: { id: 'las_dup' },
        actor: { id: 'linear_user_dup' },
      });

      const first = await ingestLinearAgent.request('/linear-agent', {
        method: 'POST',
        headers,
        body: rawBody,
      });
      const second = await ingestLinearAgent.request('/linear-agent', {
        method: 'POST',
        headers,
        body: rawBody,
      });
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      const firstJson = (await first.json()) as { sessionId: string };
      const secondJson = (await second.json()) as { sessionId: string };
      expect(secondJson.sessionId).toBe(firstJson.sessionId);

      const sessions = await db
        .select()
        .from(schema.agentSession)
        .where(eq(schema.agentSession.externalRunRef, 'linear-agent-session:las_dup'));
      expect(sessions).toHaveLength(1);
      const runs = await db
        .select()
        .from(schema.agentSessionRun)
        .where(eq(schema.agentSessionRun.sessionId, firstJson.sessionId));
      expect(runs).toHaveLength(1);
      // agentSessionUpdate is safe (and necessary) to re-issue on every delivery.
      expect(port.sessionUpdateLog).toHaveLength(2);
    });
  });

  describe('action: prompted', () => {
    async function createBaseSession(
      orgId: string,
      workspaceId: string,
      linearSessionId: string,
      initiatorActorId: string | null,
    ): Promise<string> {
      const agentId = await ensureAgent(orgId);
      const [session] = await db
        .insert(schema.agentSession)
        .values({
          organizationId: orgId,
          agentId,
          trigger: 'mention',
          status: initiatorActorId ? 'pending' : 'awaiting_input',
          initiatorId: initiatorActorId,
          externalRunRef: `linear-agent-session:${linearSessionId}`,
        })
        .returning({ id: schema.agentSession.id });
      await db.insert(schema.agentSessionExternalLink).values({
        sessionId: session!.id,
        organizationId: orgId,
        provider: 'linear',
        externalSessionId: linearSessionId,
        externalWorkspaceId: workspaceId,
      });
      return session!.id;
    }

    async function ensureAgent(orgId: string): Promise<string> {
      const [a] = await db
        .insert(schema.actor)
        .values({ organizationId: orgId, kind: 'agent', displayName: 'Athena' })
        .returning({ id: schema.actor.id });
      const [row] = await db
        .insert(schema.agent)
        .values({ organizationId: orgId, actorId: a!.id })
        .returning({ id: schema.agent.id });
      return row!.id;
    }

    it('records the reply and queues a resume when identity is already resolved', async () => {
      const seeded = await seedOrgWithLinearAgent();
      const linearActorId = await seedLinkedLinearActor(seeded.orgId, 'linear_user_prompt');
      const port = new MockLinearAgent();
      buildLinearAgentClient.mockReturnValue(port);
      const sessionId = await createBaseSession(
        seeded.orgId,
        seeded.workspaceId,
        'las_p1',
        linearActorId,
      );
      // Drive the session's status away from `pending` to prove the reply reopens it.
      await db
        .update(schema.agentSession)
        .set({ status: 'completed', endedAt: new Date() })
        .where(eq(schema.agentSession.id, sessionId));

      const { headers, rawBody } = signed({
        action: 'prompted',
        organizationId: seeded.workspaceId,
        agentSession: { id: 'las_p1' },
        actor: { id: 'linear_user_prompt' },
        agentActivity: { body: 'One more thing — also check the staging config.' },
      });

      const res = await ingestLinearAgent.request('/linear-agent', {
        method: 'POST',
        headers,
        body: rawBody,
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ received: true, processed: true, sessionId });

      const [session] = await db
        .select()
        .from(schema.agentSession)
        .where(eq(schema.agentSession.id, sessionId));
      expect(session?.status).toBe('running');

      const activities = await db
        .select()
        .from(schema.sessionActivity)
        .where(
          and(
            eq(schema.sessionActivity.sessionId, sessionId),
            eq(schema.sessionActivity.type, 'response'),
          ),
        );
      expect(
        activities.some(
          (a) =>
            a.body.text === 'One more thing — also check the staging config.' &&
            a.body['author'] === 'user',
        ),
      ).toBe(true);

      const runs = await db
        .select()
        .from(schema.agentSessionRun)
        .where(eq(schema.agentSessionRun.sessionId, sessionId));
      expect(runs).toHaveLength(1);
      expect(runs[0]?.status).toBe('queued');
    });

    it('resolves a previously-unknown identity from the prompted delivery and then queues a resume', async () => {
      const seeded = await seedOrgWithLinearAgent();
      const port = new MockLinearAgent();
      buildLinearAgentClient.mockReturnValue(port);
      const sessionId = await createBaseSession(seeded.orgId, seeded.workspaceId, 'las_p2', null);
      const linearActorId = await seedLinkedLinearActor(seeded.orgId, 'linear_user_late');

      const { headers, rawBody } = signed({
        action: 'prompted',
        organizationId: seeded.workspaceId,
        agentSession: { id: 'las_p2' },
        actor: { id: 'linear_user_late' },
        agentActivity: { body: 'I linked my account now.' },
      });

      const res = await ingestLinearAgent.request('/linear-agent', {
        method: 'POST',
        headers,
        body: rawBody,
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ received: true, processed: true, sessionId });

      const [session] = await db
        .select()
        .from(schema.agentSession)
        .where(eq(schema.agentSession.id, sessionId));
      expect(session?.initiatorId).toBe(linearActorId);
      expect(session?.status).toBe('running');

      const runs = await db
        .select()
        .from(schema.agentSessionRun)
        .where(eq(schema.agentSessionRun.sessionId, sessionId));
      expect(runs).toHaveLength(1);
    });

    it('ACKs without queuing when identity is still unresolved', async () => {
      const seeded = await seedOrgWithLinearAgent();
      const port = new MockLinearAgent();
      buildLinearAgentClient.mockReturnValue(port);
      const sessionId = await createBaseSession(seeded.orgId, seeded.workspaceId, 'las_p3', null);

      const { headers, rawBody } = signed({
        action: 'prompted',
        organizationId: seeded.workspaceId,
        agentSession: { id: 'las_p3' },
        actor: { id: 'linear_user_still_unknown' },
        agentActivity: { body: 'hello?' },
      });

      const res = await ingestLinearAgent.request('/linear-agent', {
        method: 'POST',
        headers,
        body: rawBody,
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ received: true, processed: false });

      const [session] = await db
        .select()
        .from(schema.agentSession)
        .where(eq(schema.agentSession.id, sessionId));
      expect(session?.status).toBe('awaiting_input');
      expect(session?.initiatorId).toBeNull();

      const runs = await db
        .select()
        .from(schema.agentSessionRun)
        .where(eq(schema.agentSessionRun.sessionId, sessionId));
      expect(runs).toHaveLength(0);
    });

    it('ACKs when no session matches the external run ref (stale/out-of-order delivery)', async () => {
      const seeded = await seedOrgWithLinearAgent();
      const port = new MockLinearAgent();
      buildLinearAgentClient.mockReturnValue(port);

      const { headers, rawBody } = signed({
        action: 'prompted',
        organizationId: seeded.workspaceId,
        agentSession: { id: 'las_never_created' },
        actor: { id: 'linear_user_x' },
        agentActivity: { body: 'hello?' },
      });

      const res = await ingestLinearAgent.request('/linear-agent', {
        method: 'POST',
        headers,
        body: rawBody,
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ received: true, processed: false });
    });
  });
});
