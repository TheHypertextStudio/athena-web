/**
 * MCP e2e Flow B — agent-session lifecycle over MCP (build-manifest §MCP-17, `mcp-session`).
 *
 * An `agents:run`-scoped MCP client triggers an agent session, watches it park at the
 * approval gate, and approves the proposed action — the human-in-the-loop path a real
 * orchestrating agent drives. The scripted `MockAgentRuntime` makes the sequence
 * deterministic (`thought → action(proposed) → …` always parks at `awaiting_approval`).
 *
 * Divergence from the original manifest flow: the shipped transport is stateless
 * (`sessionIdGenerator: undefined`, one server per request), so a `resources/subscribe`
 * cannot outlive its request and `notifications/resources/updated` cannot be observed
 * across calls. The session state is asserted by re-reading the session resource
 * instead — the polling pattern a stateless client actually uses in production.
 */
import { signUpAndOnboard } from './helpers/app';
import { expect, test } from './helpers/fixtures';
import { discover, mcpReadResource, mcpToolCall, mintToken, registerClient } from './helpers/mcp';
import { apiJson } from './helpers/net';

test('an MCP client can trigger an agent session and approve its proposed action', async ({
  page,
  request,
}) => {
  // Sign-up + onboarding + a full authorize/consent/token round before the session dance;
  // see mcp-connect.spec.ts for why the default 120s is too tight on a busy dev stack.
  test.slow();
  const { orgId } = await signUpAndOnboard(page, 'McpSession');

  // Register a runnable agent (backed by the scripted mock runtime) via the typed API.
  const agent = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/agents`, {
    method: 'POST',
    body: { displayName: 'E2E Scripted Agent' },
  });

  // OAuth: one client, consented for reads + session control.
  const discovery = await discover(request);
  const clientId = await registerClient(request, discovery, 'Docket E2E Session Agent');
  const token = await mintToken(page, request, discovery, {
    clientId,
    scope: 'work:read agents:run',
  });

  // ── Trigger over MCP: a pending session bound to the agent ──
  const session = await mcpToolCall<{ id: string; status: string }>(
    request,
    token,
    'trigger_agent',
    { orgId, agentId: agent.id, prompt: 'Plan the launch checklist' },
  );
  expect(session.status).toBe('pending');

  // ── Drive the runtime (the substrate act a human/automation performs) ──
  const settled = await apiJson<{ status: string }>(
    page,
    `/v1/orgs/${orgId}/sessions/${session.id}/run`,
    { method: 'POST' },
  );
  expect(settled.status).toBe('awaiting_approval');

  // ── The MCP client observes the approval gate on the session resource ──
  const sessionUri = `docket://${orgId}/session/${session.id}`;
  const parked = await mcpReadResource<{
    status: string;
    activities: { type: string; approvalStatus: string | null }[];
  }>(request, token, sessionUri);
  expect(parked.status).toBe('awaiting_approval');
  expect(
    parked.activities.some((a) => a.type === 'action' && a.approvalStatus === 'proposed'),
  ).toBe(true);

  // ── Approve over MCP: the session resumes ──
  const approved = await mcpToolCall<{ id: string; status: string }>(
    request,
    token,
    'approve_action',
    { orgId, sessionId: session.id },
  );
  expect(approved.status).toBe('running');

  const resumed = await mcpReadResource<{
    status: string;
    activities: { type: string; approvalStatus: string | null }[];
  }>(request, token, sessionUri);
  expect(resumed.status).toBe('running');
  expect(resumed.activities.some((a) => a.approvalStatus === 'approved')).toBe(true);
});
