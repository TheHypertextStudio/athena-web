/**
 * `@docket/integrations` — the Linear **Agent** platform boundary adapter.
 *
 * @remarks
 * Linear ships two entirely separate integration surfaces that happen to share a vendor name:
 * the data-sync connector in {@link import('./linear').LinearProviderClient} (a per-user OAuth
 * grant that mirrors issues/projects/cycles into Docket's work graph), and the **Agent**
 * platform this file adapts — a distinct OAuth app installed with `actor=app` (an app-level
 * identity, not a user impersonation) that receives `AgentSessionEvent` webhooks whenever a
 * human `@mentions` or delegates work to the agent, and that talks back through two GraphQL
 * mutations (`agentActivityCreate` to post activity, `agentSessionUpdate` to attach the
 * "open in Docket" external URL Linear requires within 10 seconds of session creation).
 *
 * This boundary deliberately does not route through the generic `Observer`/ingest pipeline used
 * by {@link import('./observer-linear').RealLinearObserver} — an agent session is a categorically
 * different kind of event (an inbound *delegation* to act on, not an activity-feed item to
 * mirror) — so it gets its own small, self-contained webhook-verification helper here rather
 * than forcing a second shape through the `Observer` interface.
 *
 * Field names in {@link parseLinearAgentWebhook}'s schema are grounded in Linear's public
 * agent-platform docs (`linear.app/developers/agent-interaction`, `linear.app/developers/agents`,
 * `linear.app/developers/webhooks`, `linear.app/developers/oauth-2-0-authentication`) as of this
 * writing, but have not been exercised against a real webhook delivery — no Agent app is
 * registered yet. The schema is deliberately `.loose()`-permissive so an unanticipated
 * extra field never causes a parse failure; only the specific fields this module's functions
 * promise to return are pulled out, and those should be re-verified against a live delivery
 * once the app exists.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import type { SessionActivityType } from '@docket/types';
import { z } from 'zod';

import { ConnectorError } from './connector-error';
import { defaultHttpClient, type HttpClient } from './http';
import { ProviderHttp } from './provider-http';

// ---------------------------------------------------------------------------
// OAuth2: `actor=app` authorize URL + code exchange / refresh
// ---------------------------------------------------------------------------

/** Linear's authorization endpoint for the Agent (`actor=app`) install flow. */
const LINEAR_AGENT_AUTHORIZE_URL = 'https://linear.app/oauth/authorize';

/** Linear's token endpoint (shared by the code-exchange and refresh grants). */
const LINEAR_AGENT_TOKEN_URL = 'https://api.linear.app/oauth/token';

/** Linear's GraphQL API base the Agent's authenticated mutations POST to. */
const LINEAR_AGENT_API_BASE = 'https://api.linear.app';

/**
 * The scopes an Agent app requests by default: mentionability (so `@AgentName` in an issue or
 * document creates a session) and assignability (so an issue can be delegated to it).
 */
const DEFAULT_LINEAR_AGENT_SCOPE = 'app:mentionable,app:assignable';

/** Input to {@link buildLinearAgentAuthorizeUrl}. */
export interface BuildLinearAgentAuthorizeUrlInput {
  /** The Agent app's OAuth client id. */
  readonly clientId: string;
  /** The registered callback URL Linear redirects back to with `?code=`. */
  readonly redirectUri: string;
  /** Opaque CSRF-protection value, echoed back on the callback. */
  readonly state: string;
  /** Comma-separated Linear scopes; defaults to {@link DEFAULT_LINEAR_AGENT_SCOPE}. */
  readonly scope?: string;
}

/**
 * Build the Linear OAuth authorize URL for installing the Agent app into a workspace.
 *
 * @remarks
 * `actor=app` is what makes this an Agent-platform install rather than a per-user sign-in
 * grant: Linear treats the resulting token as belonging to the app itself, so subsequent
 * mutations ({@link agentActivityCreate}, {@link agentSessionUpdate}) are attributed to the
 * agent, not the installing human. Pure and network-free, so it is directly unit-testable.
 *
 * @param input - The OAuth client id, callback URL, CSRF `state`, and optional scope override.
 * @returns the fully-formed `https://linear.app/oauth/authorize?...` URL.
 */
export function buildLinearAgentAuthorizeUrl(input: BuildLinearAgentAuthorizeUrlInput): string {
  const url = new URL(LINEAR_AGENT_AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('scope', input.scope ?? DEFAULT_LINEAR_AGENT_SCOPE);
  url.searchParams.set('state', input.state);
  url.searchParams.set('actor', 'app');
  return url.toString();
}

/**
 * One workspace's OAuth token pair for the Agent install, as returned by Linear's token
 * endpoint (camelCased from the wire's snake_case).
 */
export interface LinearAgentOAuthTokens {
  /** Bearer token every {@link LinearAgentClient} call authenticates with. */
  readonly accessToken: string;
  /** Always `"Bearer"` today; carried through rather than assumed. */
  readonly tokenType: string;
  /** Seconds until {@link LinearAgentOAuthTokens.accessToken} expires (Linear: 24h). */
  readonly expiresIn: number;
  /** The granted scopes, comma-separated, as Linear echoes them back. */
  readonly scope: string;
  /**
   * The token to exchange for a fresh pair via {@link refreshLinearAgentToken}.
   *
   * @remarks
   * Linear invalidates the previous access+refresh pair on every successful refresh, so the
   * caller MUST persist this new value — reusing a rotated-out refresh token fails.
   */
  readonly refreshToken: string;
}

/** Raw shape of Linear's `POST /oauth/token` response (snake_case, per OAuth2). */
const linearAgentTokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number(),
  scope: z.string(),
  refresh_token: z.string(),
});

/** Truncate a provider error body kept for diagnostics (avoids logging huge payloads). */
const ERROR_BODY_SNIPPET_LIMIT = 200;

/**
 * POST one `application/x-www-form-urlencoded` grant to Linear's token endpoint.
 *
 * @remarks
 * Shared by {@link exchangeLinearAgentCode} and {@link refreshLinearAgentToken} — the two
 * grants (`authorization_code`, `refresh_token`) differ only in which params they send; the
 * request shape, error handling, and response parsing are identical. This intentionally does
 * NOT go through {@link ProviderHttp}: that wrapper always attaches a `Bearer` token, but a
 * token exchange has no token yet — the client id/secret travel in the form body instead.
 */
async function postLinearAgentTokenGrant(
  params: Record<string, string>,
  http: HttpClient,
): Promise<LinearAgentOAuthTokens> {
  let res: Response;
  try {
    res = await http(LINEAR_AGENT_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams(params).toString(),
    });
  } catch (cause) {
    throw new ConnectorError('linear-agent oauth token request could not reach the provider', {
      provider: 'linear',
      kind: 'network',
      cause,
    });
  }
  if (!res.ok) {
    const snippet = await res
      .text()
      .then((t) => t.slice(0, ERROR_BODY_SNIPPET_LIMIT))
      .catch(() => '');
    throw new ConnectorError(
      `linear-agent oauth token exchange failed: ${res.status}${snippet ? ` — ${snippet}` : ''}`,
      { provider: 'linear', kind: ConnectorError.kindForStatus(res.status), status: res.status },
    );
  }
  const json: unknown = await res.json().catch(() => undefined);
  const parsed = linearAgentTokenResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new ConnectorError('linear-agent oauth token response had an unexpected shape', {
      provider: 'linear',
      kind: 'provider',
    });
  }
  return {
    accessToken: parsed.data.access_token,
    tokenType: parsed.data.token_type,
    expiresIn: parsed.data.expires_in,
    scope: parsed.data.scope,
    refreshToken: parsed.data.refresh_token,
  };
}

/** Input to {@link exchangeLinearAgentCode}. */
export interface ExchangeLinearAgentCodeInput {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  /** The `code` query param Linear appended to the `redirectUri` callback. */
  readonly code: string;
  /** HTTP transport (defaults to the platform `fetch`). */
  readonly http?: HttpClient;
}

/**
 * Exchange an OAuth authorization code for the workspace's Agent install token pair.
 *
 * @remarks
 * This is the one-time step that follows a human approving the `actor=app` authorize URL
 * ({@link buildLinearAgentAuthorizeUrl}) — Linear issues exactly one access+refresh token pair
 * per workspace install directly from this exchange. There is no separate "installation token
 * minting" step the way GitHub Apps have (contrast
 * {@link import('./github-app').mintInstallationToken}): the pair returned here IS the
 * long-lived server-to-server credential, refreshed in place via
 * {@link refreshLinearAgentToken}.
 *
 * @param input - The client credentials, registered redirect URI, and the received `code`.
 * @returns the workspace's access+refresh token pair.
 * @throws {ConnectorError} (`auth`) on a rejected code/credentials, (`network`) if the request
 *   never completes, or (`provider`) on an unparseable response.
 */
export async function exchangeLinearAgentCode(
  input: ExchangeLinearAgentCodeInput,
): Promise<LinearAgentOAuthTokens> {
  return postLinearAgentTokenGrant(
    {
      grant_type: 'authorization_code',
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      code: input.code,
    },
    input.http ?? defaultHttpClient,
  );
}

/** Input to {@link refreshLinearAgentToken}. */
export interface RefreshLinearAgentTokenInput {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
  /** HTTP transport (defaults to the platform `fetch`). */
  readonly http?: HttpClient;
}

/**
 * Refresh an Agent install's access token before its 24-hour expiry.
 *
 * @param input - The client credentials and the workspace's current refresh token.
 * @returns a fresh access+refresh token pair (the previous pair is invalidated by Linear).
 * @throws {ConnectorError} (`auth`) on a rejected/expired refresh token, (`network`) if the
 *   request never completes, or (`provider`) on an unparseable response.
 */
export async function refreshLinearAgentToken(
  input: RefreshLinearAgentTokenInput,
): Promise<LinearAgentOAuthTokens> {
  return postLinearAgentTokenGrant(
    {
      grant_type: 'refresh_token',
      client_id: input.clientId,
      client_secret: input.clientSecret,
      refresh_token: input.refreshToken,
    },
    input.http ?? defaultHttpClient,
  );
}

/**
 * The persisted shape of a `linear_agent` integration's sealed credential: the token pair plus
 * when it was obtained, so a reader can tell whether it's due for {@link refreshLinearAgentToken}
 * before use (mirrors {@link import('./mcp-oauth').McpOAuthCredential}'s `obtainedAt`).
 */
export interface StoredLinearAgentTokens extends LinearAgentOAuthTokens {
  /** ISO timestamp of when this token pair was obtained (initial exchange or last refresh). */
  readonly obtainedAt: string;
}

/** How much earlier than the token's real expiry to treat it as due for refresh. */
const LINEAR_AGENT_REFRESH_MARGIN_MS = 60_000;

/** Whether a stored Agent install token is due for {@link refreshLinearAgentToken} before use. */
export function linearAgentTokenNeedsRefresh(
  credential: StoredLinearAgentTokens,
  nowMs: number = Date.now(),
): boolean {
  const obtainedAt = Date.parse(credential.obtainedAt);
  return (
    !Number.isFinite(obtainedAt) ||
    obtainedAt + credential.expiresIn * 1_000 - LINEAR_AGENT_REFRESH_MARGIN_MS <= nowMs
  );
}

// ---------------------------------------------------------------------------
// Webhook signature verification
// ---------------------------------------------------------------------------

/** Linear's documented maximum delivery age before a signed request is treated as a replay. */
const LINEAR_AGENT_REPLAY_WINDOW_MS = 60_000;

/** The one field this module reads out of the webhook body to enforce the replay window. */
const linearAgentWebhookTimestampSchema = z.object({ webhookTimestamp: z.number() }).loose();

/**
 * Verify a Linear `AgentSessionEvent` webhook delivery's HMAC signature and replay window.
 *
 * @remarks
 * Duplicated from — rather than shared with —
 * {@link import('./observer-linear').RealLinearObserver.verifySignature} on purpose: the Agent
 * platform is a categorically different Linear feature from the regular data-change webhooks
 * `Observer` verifies, and this slice deliberately does not route Agent sessions through the
 * generic `Observer`/ingest pipeline. The crypto approach is identical — a hex HMAC-SHA256 of
 * the *raw* request body, delivered in the `Linear-Signature` header, compared in constant
 * time — because that is how Linear signs every webhook family. Unlike the regular webhook
 * observer (which reads a `linear-timestamp` header), Linear's Agent-platform docs place
 * `webhookTimestamp` (milliseconds since epoch) in the JSON body itself, so this function
 * parses `rawBody` to read it.
 *
 * @param rawBody - The exact, unmodified request body bytes as a string — re-serializing a
 *   parsed body before hashing produces a different signature and always fails verification.
 * @param headers - The inbound request headers, keyed lowercase.
 * @param secret - The Agent app's webhook signing secret.
 * @returns whether the signature is valid AND the delivery is within the replay window.
 */
export function verifyLinearAgentWebhookSignature(
  rawBody: string,
  headers: Record<string, string | undefined>,
  secret: string,
): boolean {
  const signature = headers['linear-signature'];
  if (!signature) return false;
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const sigBuf = Buffer.from(signature, 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return false;

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return false;
  }
  const timestamp = linearAgentWebhookTimestampSchema.safeParse(parsedBody);
  if (!timestamp.success) return false;
  return Math.abs(Date.now() - timestamp.data.webhookTimestamp) <= LINEAR_AGENT_REPLAY_WINDOW_MS;
}

// ---------------------------------------------------------------------------
// Webhook payload parsing
// ---------------------------------------------------------------------------

/** A Linear actor reference (`actor` on the webhook envelope) — the app or human who triggered it. */
const linearAgentActorSchema = z
  .object({
    id: z.string(),
    type: z.string().optional(),
    name: z.string().optional(),
    email: z.string().optional(),
    url: z.string().optional(),
  })
  .loose();

/** A Linear actor reference. */
export type LinearAgentActor = z.infer<typeof linearAgentActorSchema>;

/**
 * The `agentSession` sub-object common to both webhook actions.
 *
 * @remarks
 * Linear's docs describe `agentSession.issue`, `.comment`, `.previousComments`, and
 * `.guidance` fields carrying the session's work context, but do not publish their exact
 * nested shapes. `.loose()` preserves those fields unparsed rather than dropping them;
 * only `id` (what every downstream caller needs to address the session) is asserted here.
 */
const linearAgentSessionRefSchema = z
  .object({
    id: z.string(),
  })
  .loose();

/** The `agentActivity` sub-object on a `prompted` delivery — the human's follow-up message. */
const linearAgentActivityRefSchema = z
  .object({
    id: z.string().optional(),
    body: z.string(),
  })
  .loose();

/** Fields common to every `AgentSessionEvent` delivery, regardless of `action`. */
const linearAgentWebhookBaseSchema = z.object({
  type: z.string().optional(),
  organizationId: z.string().optional(),
  webhookTimestamp: z.number().optional(),
  createdAt: z.string().optional(),
  agentSession: linearAgentSessionRefSchema,
  actor: linearAgentActorSchema.optional(),
});

/** A new agent session — the human `@mentioned` or delegated work to the agent for the first time. */
const linearAgentSessionCreatedSchema = linearAgentWebhookBaseSchema
  .extend({ action: z.literal('created') })
  .loose();

/** A follow-up human message on an already-open agent session. */
const linearAgentSessionPromptedSchema = linearAgentWebhookBaseSchema
  .extend({ action: z.literal('prompted'), agentActivity: linearAgentActivityRefSchema })
  .loose();

/** A `created`-action `AgentSessionEvent` webhook delivery. */
export type LinearAgentSessionCreated = z.infer<typeof linearAgentSessionCreatedSchema>;
/** A `prompted`-action `AgentSessionEvent` webhook delivery. */
export type LinearAgentSessionPrompted = z.infer<typeof linearAgentSessionPromptedSchema>;

/**
 * Parse an inbound Linear `AgentSessionEvent` webhook body into a typed union.
 *
 * @remarks
 * Discriminates on `action` (`created` | `prompted`) — the two `AgentSessionEvent` variants
 * Linear's agent-interaction docs currently describe. Any other shape — malformed JSON, a body
 * missing `action`, or a webhook family this module does not model — safely returns `null`
 * rather than throwing, so a caller's route handler can still acknowledge the delivery (Linear
 * retries on a non-2xx response) after logging the unrecognized shape.
 *
 * @param payload - The parsed JSON webhook body.
 * @returns the typed `created`/`prompted` event, or `null` when the shape doesn't match either.
 */
export function parseLinearAgentWebhook(
  payload: unknown,
): LinearAgentSessionCreated | LinearAgentSessionPrompted | null {
  const created = linearAgentSessionCreatedSchema.safeParse(payload);
  if (created.success) return created.data;
  const prompted = linearAgentSessionPromptedSchema.safeParse(payload);
  if (prompted.success) return prompted.data;
  return null;
}

// ---------------------------------------------------------------------------
// Authenticated GraphQL calls (agentActivityCreate / agentSessionUpdate)
// ---------------------------------------------------------------------------

/** A Linear GraphQL envelope: the typed `data` payload, plus any `errors[]` (mirrors `linear.ts`). */
interface LinearAgentGraphQLResponse<T> {
  readonly data?: T;
  readonly errors?: { readonly message: string }[];
}

/**
 * An authenticated capability to call Linear's Agent-app GraphQL API.
 *
 * @remarks
 * Bundles the token this Agent install authenticates with (an `actor=app` access token, from
 * {@link exchangeLinearAgentCode}/{@link refreshLinearAgentToken}) with the injected HTTP
 * transport, mirroring {@link import('./linear').LinearProviderClient}'s `http`-wrapped shape.
 * {@link agentActivityCreate} and {@link agentSessionUpdate} operate against this via
 * {@link LinearAgentClient.query}.
 */
export class LinearAgentClient {
  private readonly http: ProviderHttp;

  /**
   * @param accessToken - The workspace's Agent install access token.
   * @param http - Injected HTTP transport (defaults to the platform `fetch`).
   */
  constructor(accessToken: string, http: HttpClient = defaultHttpClient) {
    this.http = new ProviderHttp('linear', LINEAR_AGENT_API_BASE, accessToken, http);
  }

  /**
   * Run one GraphQL operation and return its `data` payload.
   *
   * @remarks
   * Linear can answer a 200 with a populated `errors[]` (e.g. a revoked install surfaces as an
   * "authentication"/"access" GraphQL error rather than a 401), so these are raised as typed
   * {@link ConnectorError}s — auth-shaped messages become `auth`, the rest `provider` — mirroring
   * {@link import('./linear').LinearProviderClient}'s private `query` method exactly.
   *
   * @throws {ConnectorError} (`auth`/`provider`) on a GraphQL error, or (`provider`) when `data`
   *   is absent.
   */
  async query<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const body = variables !== undefined ? { query, variables } : { query };
    const json = await this.http.postJson<LinearAgentGraphQLResponse<T>>('/graphql', body);
    if (json.errors && json.errors.length > 0) {
      const message = json.errors.map((e) => e.message).join('; ');
      const kind = /auth|unauthorized|access|token|forbidden/i.test(message) ? 'auth' : 'provider';
      throw new ConnectorError(`linear-agent GraphQL error: ${message}`, {
        provider: 'linear',
        kind,
      });
    }
    if (json.data === undefined) {
      throw new ConnectorError('linear-agent GraphQL response missing data', {
        provider: 'linear',
        kind: 'provider',
      });
    }
    return json.data;
  }
}

/**
 * The Activity-stream entry kind Linear's `agentActivityCreate` accepts.
 *
 * @remarks
 * Mirrors `SessionActivityType` from `@docket/types` (`packages/types/src/agent.ts`) 1:1 —
 * Docket's own session-activity taxonomy was modeled on Linear's Agent-platform vocabulary, so
 * the two must stay in sync if either changes. Re-exported under this name rather than
 * re-exporting `SessionActivityType` directly so call sites reading this file don't have to
 * guess whether it is a Docket-native or a Linear-native concept.
 */
export type LinearAgentActivityType = SessionActivityType;

/** Input to {@link agentActivityCreate}. */
export interface AgentActivityCreateInput {
  readonly agentSessionId: string;
  readonly type: LinearAgentActivityType;
  /**
   * The activity's Markdown body.
   *
   * @remarks
   * Linear's real `action`-type content additionally carries `action`/`parameter`/`result`
   * fields (a structured tool-call shape) distinct from the `body` field used by
   * `thought`/`elicitation`/`response`/`error`. This slice's callers only ever post text-bodied
   * activity today, so `body` is the one payload field modeled here; posting a `type: 'action'`
   * activity sends `content: { type: 'action', body }`, which is schema-valid but omits the
   * richer `action`/`parameter` fields a real tool-invocation activity would carry — extend
   * this input if/when Docket starts posting those.
   */
  readonly body: string;
  /** Ephemeral activities (e.g. progress ticks) are not persisted in the session's history. */
  readonly ephemeral?: boolean;
}

/** The `agentActivityCreate` mutation (see {@link AgentActivityCreateInput} for the content-shape caveat). */
const AGENT_ACTIVITY_CREATE_MUTATION = `
  mutation AgentActivityCreate($input: AgentActivityCreateInput!) {
    agentActivityCreate(input: $input) {
      success
      agentActivity { id }
    }
  }
`;

/**
 * Post one Activity-stream entry to a Linear agent session.
 *
 * @param client - The authenticated {@link LinearAgentClient}.
 * @param input - The session to post to, the entry's type + Markdown body, and ephemeral flag.
 * @returns the created activity's id.
 * @throws {ConnectorError} (`provider`) when Linear reports `success: false` or omits the
 *   created activity; (`auth`/`provider`) on a GraphQL error (see {@link LinearAgentClient.query}).
 */
export async function agentActivityCreate(
  client: LinearAgentClient,
  input: AgentActivityCreateInput,
): Promise<{ id: string }> {
  const data = await client.query<{
    agentActivityCreate?: { success?: boolean; agentActivity?: { id?: string } };
  }>(AGENT_ACTIVITY_CREATE_MUTATION, {
    input: {
      agentSessionId: input.agentSessionId,
      content: { type: input.type, body: input.body },
      ...(input.ephemeral !== undefined ? { ephemeral: input.ephemeral } : {}),
    },
  });
  const id = data.agentActivityCreate?.agentActivity?.id;
  if (data.agentActivityCreate?.success !== true || id === undefined) {
    throw new ConnectorError('linear-agent agentActivityCreate did not succeed', {
      provider: 'linear',
      kind: 'provider',
    });
  }
  return { id };
}

/** One external URL Linear displays as a deep link on an agent session (e.g. "Open in Docket"). */
export interface LinearAgentExternalUrl {
  readonly label: string;
  readonly url: string;
}

/** Input to {@link agentSessionUpdate}. */
export interface AgentSessionUpdateInput {
  readonly agentSessionId: string;
  /**
   * Replaces the session's entire external-URL list.
   *
   * @remarks
   * Linear also exposes `addedExternalUrls`/`removedExternalUrls` on the same mutation for
   * incremental edits, but this slice only needs the "set the one Docket deep link" case —
   * Linear requires an external URL be attached within 10 seconds of session creation, and this
   * replace-whole-array form is the simplest way to satisfy that. `agentPlan` support is
   * explicitly out of scope here.
   */
  readonly externalUrls: readonly LinearAgentExternalUrl[];
}

/** The `agentSessionUpdate` mutation (see {@link AgentSessionUpdateInput} for scope notes). */
const AGENT_SESSION_UPDATE_MUTATION = `
  mutation AgentSessionUpdate($id: String!, $input: AgentSessionUpdateInput!) {
    agentSessionUpdate(id: $id, input: $input) {
      success
    }
  }
`;

/**
 * Set the external URL(s) shown on a Linear agent session.
 *
 * @param client - The authenticated {@link LinearAgentClient}.
 * @param input - The session id and its full external-URL list.
 * @throws {ConnectorError} (`provider`) when Linear reports `success: false`; (`auth`/`provider`)
 *   on a GraphQL error.
 */
export async function agentSessionUpdate(
  client: LinearAgentClient,
  input: AgentSessionUpdateInput,
): Promise<void> {
  const data = await client.query<{ agentSessionUpdate?: { success?: boolean } }>(
    AGENT_SESSION_UPDATE_MUTATION,
    { id: input.agentSessionId, input: { externalUrls: input.externalUrls } },
  );
  if (data.agentSessionUpdate?.success !== true) {
    throw new ConnectorError('linear-agent agentSessionUpdate did not succeed', {
      provider: 'linear',
      kind: 'provider',
    });
  }
}

// ---------------------------------------------------------------------------
// Uniform port — so a caller can hold either the real or mock client without branching
// ---------------------------------------------------------------------------

/**
 * The capability surface a session-runner/relay caller actually needs, satisfied identically
 * by {@link RealLinearAgentPort} and `MockLinearAgent` (`./mock-linear-agent`).
 *
 * @remarks
 * {@link agentActivityCreate}/{@link agentSessionUpdate} are free functions taking an explicit
 * {@link LinearAgentClient} — the right shape for this file's own tests, which inject a fake
 * `HttpClient` — but a composition root (`container.ts`'s `buildLinearAgentClient`) needs to
 * hand callers ONE object usable the same way whether it resolved to the real adapter or the
 * offline mock. This interface is that common shape; the mock already satisfies it structurally
 * (method names/signatures match 1:1, `this` standing in for `client`), so only the real side
 * needs an adapter.
 */
export interface LinearAgentPort {
  agentActivityCreate(input: AgentActivityCreateInput): Promise<{ id: string }>;
  agentSessionUpdate(input: AgentSessionUpdateInput): Promise<void>;
}

/** Adapts an authenticated {@link LinearAgentClient} to the {@link LinearAgentPort} shape. */
export class RealLinearAgentPort implements LinearAgentPort {
  constructor(private readonly client: LinearAgentClient) {}

  agentActivityCreate(input: AgentActivityCreateInput): Promise<{ id: string }> {
    return agentActivityCreate(this.client, input);
  }

  agentSessionUpdate(input: AgentSessionUpdateInput): Promise<void> {
    return agentSessionUpdate(this.client, input);
  }
}
