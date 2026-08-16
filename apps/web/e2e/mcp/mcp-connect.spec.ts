/**
 * MCP e2e Flow A — connect, read, step-up, write (`mcp-connect`).
 *
 * The full OAuth 2.1 chain a real coding agent walks, with nothing mocked:
 * discovery (RFC 9728 → 8414) → dynamic client registration → browser consent →
 * PKCE code exchange → Bearer-authenticated MCP read → 403 `insufficient_scope`
 * step-up challenge on a write → re-consent for `work:write` → the write lands
 * (verified back through the typed `/v1` API). Also the live verification that
 * tokens are audience-bound and scope-limited by the real Better Auth AS.
 */
import { signUpAndOnboard } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';
import {
  authorizeInBrowser,
  discover,
  exchangeCode,
  mcpCall,
  mcpReadResource,
  mcpToolCall,
  mintToken,
  registerClient,
} from '../helpers/mcp';
import { apiJson } from '../helpers/net';

test('an MCP client can discover, register, consent, read, step up, and write', async ({
  page,
  request,
}) => {
  // ── No credential: /mcp must answer 401 with the discovery-pointing challenge ──
  const unauthed = await mcpCall(request, null, 'tools/list', {});
  expect(unauthed.status).toBe(401);
  expect(unauthed.wwwAuthenticate).toContain('resource_metadata=');
  // The challenge is the only hint that reaches a client before it builds its authorize URL, and
  // a client asks for exactly what it advertises. If it ever narrows again, connectors silently
  // go back to being read-only (or, without `offline_access`, non-renewable).
  for (const scope of [
    'work:read',
    'work:write',
    'agents:run',
    'connectors:link',
    'offline_access',
  ]) {
    expect(unauthed.wwwAuthenticate, `401 challenge must advertise ${scope}`).toContain(scope);
  }

  // ── A real signed-in human (passkey ceremony) to consent on behalf of ──
  const { orgId } = await signUpAndOnboard(page, 'McpConnect');

  // ── Discover → register ──
  const discovery = await discover();
  const clientId = await registerClient(discovery, 'Docket E2E Agent');

  // ── Consent for read-only; the minted token carries exactly that scope ──
  const readToken = await mintToken(page, discovery, {
    clientId,
    scope: 'work:read',
  });

  const tools = await mcpCall(request, readToken, 'tools/list', {});
  expect(tools.status).toBe(200);
  const toolNames = (
    (tools.body as { result?: { tools?: { name: string }[] } }).result?.tools ?? []
  ).map((t) => t.name);
  expect(toolNames).toContain('capture');

  const orgs = await mcpReadResource<{ id: string }[]>(request, readToken, 'docket://orgs');
  expect(orgs.map((o) => o.id)).toContain(orgId);

  // ── A write with the read-only token: the §2.6 step-up challenge, not a silent error ──
  // `capture` resolves its own landing team, so the call names none — but onboarding must still
  // have minted one, or there would be nowhere for the captured task to land.
  const teams = await apiJson<{ items: { id: string }[] }>(page, `/v1/orgs/${orgId}/teams`);
  expect(teams.items[0]?.id, 'onboarding must have minted a team').toBeTruthy();

  const denied = await mcpCall(request, readToken, 'tools/call', {
    name: 'capture',
    arguments: { orgId, text: 'Should be blocked' },
  });
  expect(denied.status).toBe(403);
  expect(denied.wwwAuthenticate).toContain('insufficient_scope');
  expect(denied.wwwAuthenticate).toContain('work:write');

  // ── Step up: re-consent for work:write, then the same write succeeds ──
  // Exchanged explicitly (rather than via `mintToken`) so the refresh token is observable: the AS
  // mints one ONLY when `offline_access` is granted, so a step-up that dropped it would trade a
  // durable connection for one that dies 15 minutes later — invisible to every other assertion.
  const { code: stepUpCode, codeVerifier: stepUpCodeVerifier } = await authorizeInBrowser(
    page,
    discovery,
    { clientId, scope: 'work:read work:write offline_access' },
  );
  const stepUp = await exchangeCode(discovery, {
    clientId,
    code: stepUpCode,
    codeVerifier: stepUpCodeVerifier,
  });
  expect(
    stepUp.refreshToken,
    'a token granted offline_access must carry a refresh token',
  ).toBeTruthy();
  const writeToken = stepUp.accessToken;
  const created = await mcpToolCall<{ id: string; state: string }>(request, writeToken, 'capture', {
    orgId,
    text: 'Created over MCP e2e',
  });
  expect(created.id).toBeTruthy();

  // ── The write is real: the typed RPC surface sees the task ──
  const task = await apiJson<{ title: string }>(page, `/v1/orgs/${orgId}/tasks/${created.id}`);
  expect(task.title).toBe('Created over MCP e2e');
});
