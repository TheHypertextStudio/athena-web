/**
 * MCP e2e Flow A — connect, read, step-up, write (build-manifest §MCP-17, `mcp-connect`).
 *
 * The full OAuth 2.1 chain a real coding agent walks, with nothing mocked:
 * discovery (RFC 9728 → 8414) → dynamic client registration → browser consent →
 * PKCE code exchange → Bearer-authenticated MCP read → 403 `insufficient_scope`
 * step-up challenge on a write → re-consent for `work:write` → the write lands
 * (verified back through the typed `/v1` API). Also the live verification that
 * tokens are audience-bound and scope-limited by the real Better Auth AS.
 */
import { signUpAndOnboard } from './helpers/app';
import { expect, test } from './helpers/fixtures';
import {
  discover,
  mcpCall,
  mcpReadResource,
  mcpToolCall,
  mintToken,
  registerClient,
} from './helpers/mcp';
import { apiJson } from './helpers/net';

test('an MCP client can discover, register, consent, read, step up, and write', async ({
  page,
  request,
}) => {
  // The longest flow in the suite: sign-up + onboarding, then TWO full authorize/consent/
  // token rounds (read, then step-up) around the MCP calls. Triple the budget — under a
  // busy dev stack the chain legitimately exceeds the default 120s.
  test.slow();
  // ── No credential: /mcp must answer 401 with the discovery-pointing challenge ──
  const unauthed = await mcpCall(request, null, 'tools/list', {});
  expect(unauthed.status).toBe(401);
  expect(unauthed.wwwAuthenticate).toContain('resource_metadata=');

  // ── A real signed-in human (passkey ceremony) to consent on behalf of ──
  const { orgId } = await signUpAndOnboard(page, 'McpConnect');

  // ── Discover → register ──
  const discovery = await discover(request);
  const clientId = await registerClient(request, discovery, 'Docket E2E Agent');

  // ── Consent for read-only; the minted token carries exactly that scope ──
  const readToken = await mintToken(page, request, discovery, {
    clientId,
    scope: 'work:read',
  });

  const tools = await mcpCall(request, readToken, 'tools/list', {});
  expect(tools.status).toBe(200);
  const toolNames = (
    (tools.body as { result?: { tools?: { name: string }[] } }).result?.tools ?? []
  ).map((t) => t.name);
  expect(toolNames).toContain('create_task');

  const orgs = await mcpReadResource<{ id: string }[]>(request, readToken, 'docket://orgs');
  expect(orgs.map((o) => o.id)).toContain(orgId);

  // ── A write with the read-only token: the §2.6 step-up challenge, not a silent error ──
  const teams = await apiJson<{ items: { id: string }[] }>(page, `/v1/orgs/${orgId}/teams`);
  const teamId = teams.items[0]?.id;
  expect(teamId, 'onboarding must have minted a team').toBeTruthy();

  const denied = await mcpCall(request, readToken, 'tools/call', {
    name: 'create_task',
    arguments: { orgId, teamId, title: 'Should be blocked' },
  });
  expect(denied.status).toBe(403);
  expect(denied.wwwAuthenticate).toContain('insufficient_scope');
  expect(denied.wwwAuthenticate).toContain('work:write');

  // ── Step up: re-consent for work:write, then the same write succeeds ──
  const writeToken = await mintToken(page, request, discovery, {
    clientId,
    scope: 'work:read work:write',
  });
  const created = await mcpToolCall<{ id: string; state: string }>(
    request,
    writeToken,
    'create_task',
    { orgId, teamId, title: 'Created over MCP e2e' },
  );
  expect(created.id).toBeTruthy();

  // ── The write is real: the typed RPC surface sees the task ──
  const task = await apiJson<{ title: string }>(page, `/v1/orgs/${orgId}/tasks/${created.id}`);
  expect(task.title).toBe('Created over MCP e2e');
});
