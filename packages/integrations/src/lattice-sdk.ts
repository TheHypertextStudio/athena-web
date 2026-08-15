/**
 * `@docket/integrations` — the Lovelace Lattice Cloud SDK, and the ONLY module in Docket that
 * speaks HTTP to a Lattice gateway.
 *
 * @remarks
 * ## Why this file exists instead of a plain `import` from the package
 *
 * The upstream SDK is `@reasonabletech/lattice-client` (source of truth:
 * `ReasonableTech/lovelace:packages/platform/lattice-client/src/client.ts`, v0.1.0). It is **not
 * published to any registry Docket can install from**, and neither are the two private sibling
 * packages it depends on. Verified, not assumed:
 *
 * - `npm view @reasonabletech/lattice-client` → `404 Not Found`.
 * - `pnpm pack` of the upstream package produces a tarball whose manifest requires
 *   `@lovelace-ai/compute@0.1.0` and `@lovelace-ai/auth-core@0.1.0`; both also `404`.
 * - `pnpm.overrides` does not rewrite the transitive dependencies of a `file:` tarball, so
 *   pointing those two at locally packed tarballs still fails the install.
 *
 * Declaring an unresolvable dependency would break `pnpm install` for the whole monorepo, so the
 * SDK's client is vendored here **verbatim from upstream**, with only its two type-only upstream
 * imports re-declared locally (see {@link PersonalLatticeRuntimeResource} and neighbours, each
 * attributed to its upstream file). Behaviour, route paths, header names, error codes and error
 * classes are unchanged from upstream.
 *
 * ## The one-line migration when Lovelace publishes
 *
 * Replace this file's body with:
 *
 * ```ts
 * export * from '@reasonabletech/lattice-client';
 * ```
 *
 * …add `"@reasonabletech/lattice-client": "^0.1.0"` to this package's dependencies, and nothing
 * else in Docket changes: every other Lattice module imports the client from this module and only
 * this module, so there is exactly one seam to move.
 *
 * @see {@link ./lattice-gateway.ts} for Docket's own use of this client.
 */

/**
 * Bare hostname of the production Lattice gateway.
 *
 * @remarks
 * Upstream default from `lattice-client/src/client.ts`. Docket never concatenates a Lattice URL
 * anywhere else; a caller that needs a different gateway passes {@link LatticeClientOptions.baseUrl}.
 */
export const LATTICE_GATEWAY_BASE_URL = 'https://lattice.uselovelace.com';

/** Upstream request timeout, wide enough for a cold local model load. */
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Compatibility model-id prefix that routes a request to one account-owned device.
 *
 * @remarks
 * Upstream `PERSONAL_LATTICE_COMPATIBILITY_MODEL_ALIAS` from `@lovelace-ai/compute`. The full
 * selector is `lattice:personal:<latticeId>`; the gateway reads it, seals the work, and the
 * owner's daemon polls outbound for it.
 */
export const PERSONAL_LATTICE_COMPATIBILITY_MODEL_ALIAS = 'lattice:personal';

/**
 * Lifecycle state the gateway reports for one paired device.
 *
 * @remarks
 * Upstream `PersonalLatticeRuntimeStatus` from `@lovelace-ai/compute`. `unpaired` = the record
 * exists but no daemon has ever registered; `reachable` = the relay currently sees the daemon;
 * `offline` = a previously reachable daemon is gone; `revoked` = disabled.
 */
export type PersonalLatticeRuntimeStatus = 'unpaired' | 'reachable' | 'offline' | 'revoked';

/** Every {@link PersonalLatticeRuntimeStatus}, for exhaustive handling. */
export const PERSONAL_LATTICE_RUNTIME_STATUSES: readonly PersonalLatticeRuntimeStatus[] = [
  'unpaired',
  'reachable',
  'offline',
  'revoked',
];

/**
 * Which runtime family the device serves work with.
 *
 * @remarks
 * Upstream `PersonalLatticeExecutionBackend` from `@lovelace-ai/compute`. `local-model` fronts a
 * local Ollama/LM Studio server; `assistant-runtime` uses the daemon's embedded runtime.
 */
export type PersonalLatticeExecutionBackend = 'local-model' | 'assistant-runtime';

/**
 * One account-owned personal Lattice runtime — a device the user has paired.
 *
 * @remarks
 * Upstream `PersonalLatticeRuntimeResource` from `@lovelace-ai/compute`. `status` is overlaid by
 * the gateway from live relay reachability at read time, so it is never stale by more than one
 * request.
 */
export interface PersonalLatticeRuntimeResource {
  /** Stable gateway id for the device, `lat_…`. */
  readonly latticeId: string;
  /** The Lovelace account that owns the device. */
  readonly accountId: string;
  /** The name the owner gave the device. */
  readonly displayName: string;
  /** Which runtime family the device serves work with. */
  readonly executionBackend: PersonalLatticeExecutionBackend;
  /** Live reachability overlaid on the durable record. */
  readonly status: PersonalLatticeRuntimeStatus;
  /** ISO-8601 creation time. */
  readonly createdAt: string;
  /** ISO-8601 last-update time. */
  readonly updatedAt: string;
  /** ISO-8601 time the relay last saw the daemon, when it ever has. */
  readonly lastSeenAt?: string | undefined;
  /** ISO-8601 revocation time, when revoked. */
  readonly revokedAt?: string | undefined;
}

/**
 * OpenAI-compatible chat message accepted by the gateway.
 *
 * @remarks
 * Upstream `OpenAiChatMessage` from `@lovelace-ai/compute`. Note what is NOT here: there is no
 * `tool_calls` array, no `tool` role, and no `tools` request field. The gateway's compatibility
 * surface carries plain text only, which is why Athena's tool calling over Lattice runs through
 * the documented text protocol in `@docket/agent-runtime`'s `lattice-tool-protocol`.
 */
export interface OpenAiChatMessage {
  /** Who authored the message. */
  readonly role: 'system' | 'user' | 'assistant' | 'developer';
  /** The message text. */
  readonly content: string;
}

/** Token accounting the gateway returns. Upstream `OpenAiChatCompletionUsage`. */
export interface OpenAiChatCompletionUsage {
  /** Tokens consumed by the prompt. */
  readonly prompt_tokens?: number | undefined;
  /** Tokens produced by the model. */
  readonly completion_tokens?: number | undefined;
  /** Prompt plus completion. */
  readonly total_tokens?: number | undefined;
}

/** One completion choice. Upstream `OpenAiChatCompletionChoice`. */
export interface OpenAiChatCompletionChoice {
  /** Position in the choice list. */
  readonly index: number;
  /** The generated message. */
  readonly message: OpenAiChatMessage;
  /** Why generation stopped, when the provider says. */
  readonly finish_reason?: string | undefined;
}

/** A non-streaming completion. Upstream `OpenAiChatCompletionResponse`. */
export interface OpenAiChatCompletionResponse {
  /** Provider-assigned completion id. */
  readonly id: string;
  /** Always the literal `chat.completion`. */
  readonly object: 'chat.completion';
  /** Unix seconds. */
  readonly created?: number | undefined;
  /** The model the gateway actually served with. */
  readonly model: string;
  /** The generated choices. */
  readonly choices: readonly OpenAiChatCompletionChoice[];
  /** Token accounting, when reported. */
  readonly usage?: OpenAiChatCompletionUsage | undefined;
}

/**
 * Authentication credential the client sends on every request.
 *
 * @remarks
 * Upstream `LatticeCredential`. Docket only ever constructs the `oauth` arm: a developer API key
 * proves which *developer* is calling, which is not enough to route to a particular *person's*
 * device — see {@link PersonalRuntimeRequiresUserTokenError}.
 */
export type LatticeCredential = LatticeApiKeyCredential | LatticeOAuthCredential;

/** Developer API-key credential. Upstream `LatticeApiKeyCredential`. */
export interface LatticeApiKeyCredential {
  /** Discriminant. */
  readonly kind: 'apiKey';
  /** The `lv_live_…` developer key. */
  readonly apiKey: string;
}

/** End-user OAuth bearer credential. Upstream `LatticeOAuthCredential`. */
export interface LatticeOAuthCredential {
  /** Discriminant. */
  readonly kind: 'oauth';
  /** An access token issued by Lovelace accounts carrying `lattice:compute:*` scopes. */
  readonly accessToken: string;
}

/** Construction options. Upstream `LatticeClientOptions`. */
export interface LatticeClientOptions {
  /** Gateway base URL; defaults to {@link LATTICE_GATEWAY_BASE_URL}. */
  readonly baseUrl?: string | undefined;
  /** The credential used on every request. */
  readonly credential: LatticeCredential;
  /** Injected fetch, for tests and custom HTTP stacks. */
  readonly fetch?: typeof globalThis.fetch | undefined;
  /** Request timeout in milliseconds. */
  readonly timeoutMs?: number | undefined;
}

/**
 * A structured gateway failure.
 *
 * @remarks
 * Upstream `LatticeError`. `code` is the stable integration surface and is the only field Docket
 * ever branches on; `message` is provider-owned text that changes for clarity and is never
 * rendered to a person (see the UI-copy rule in AGENTS.md).
 */
export class LatticeError extends Error {
  /** HTTP status, or 0 for a transport failure. */
  readonly status: number;
  /** Stable machine-readable code parsed from the response body. */
  readonly code: string;
  /** Full parsed body, for operator diagnostics only. */
  readonly body?: unknown;

  /**
   * @param status - HTTP status, or 0 for a transport failure.
   * @param code - Stable machine-readable error code.
   * @param message - Provider-owned message; never rendered to a person.
   * @param body - Full parsed response body.
   */
  constructor(status: number, code: string, message: string, body?: unknown) {
    super(message);
    this.name = 'LatticeError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

/**
 * Thrown before any network call when a personal-runtime dispatch carries a developer API key.
 *
 * @remarks
 * Upstream `PersonalRuntimeRequiresUserTokenError`. An API key says which developer is calling,
 * not which person's device to route to, so this is a client-side guard rather than a round trip.
 */
export class PersonalRuntimeRequiresUserTokenError extends LatticeError {
  /** Builds the fixed 403 / `personal_runtime_requires_user_token` failure. */
  constructor() {
    super(
      403,
      'personal_runtime_requires_user_token',
      'Personal-runtime dispatch requires a user OAuth access token as the credential, not a developer API key.',
    );
    this.name = 'PersonalRuntimeRequiresUserTokenError';
  }
}

/**
 * Thrown when the targeted device is not currently reachable.
 *
 * @remarks
 * Upstream `PersonalRuntimeUnreachableError`. This is deliberately terminal and is never retried
 * against other capacity: silently serving a request on a stranger's machine when the user asked
 * for their own would defeat the entire point of asking. Docket surfaces it as an explicit
 * unavailable state.
 */
export class PersonalRuntimeUnreachableError extends LatticeError {
  /**
   * @param body - Full parsed response body.
   */
  constructor(body?: unknown) {
    super(
      409,
      'runtime_unreachable',
      'The requested personal runtime is not currently reachable.',
      body,
    );
    this.name = 'PersonalRuntimeUnreachableError';
  }
}

/** A device selector resolved into a model-compatible target. Upstream `PersonalRuntimeTarget`. */
export interface PersonalRuntimeTarget {
  /** The device id. */
  readonly latticeId: string;
  /** The `lattice:personal:<latticeId>` model selector. */
  readonly model: string;
}

/** Anything that can name a device. Upstream `PersonalRuntimeSelector`. */
export type PersonalRuntimeSelector =
  | string
  | PersonalRuntimeTarget
  | PersonalLatticeRuntimeResource;

/** An OpenAI-compatible chat request. Upstream `ChatCompletionsRequest`. */
export interface ChatCompletionsRequest {
  /** A canonical model id or a personal-runtime target. */
  readonly model: string | PersonalRuntimeTarget;
  /** The conversation. */
  readonly messages: readonly OpenAiChatMessage[];
  /** Sampling temperature. */
  readonly temperature?: number | undefined;
  /** Output token ceiling; sent on the wire as `max_tokens`. */
  readonly maxTokens?: number | undefined;
  /** Stable key so a retried dispatch is not executed twice. */
  readonly idempotencyKey?: string | undefined;
}

/** A chat request already bound to one device. Upstream `PersonalRuntimeChatCompletionsRequest`. */
export type PersonalRuntimeChatCompletionsRequest = Omit<ChatCompletionsRequest, 'model'>;

/** Body shape of `GET /v1/personal-runtimes`. */
interface PersonalRuntimeListResponseBody {
  readonly runtimes: readonly PersonalLatticeRuntimeResource[];
}

/** Per-request knobs for the low-level helper. */
interface LatticeRequestOptions {
  readonly body?: unknown;
  readonly idempotencyKey?: string | undefined;
}

/**
 * Build the model-compatible target for one device.
 *
 * @remarks
 * Upstream `personalRuntimeTarget`.
 *
 * @param selector - A device id, a runtime resource, or an already-built target.
 * @returns The target carrying the `lattice:personal:<latticeId>` model selector.
 * @throws {LatticeError} With code `invalid_personal_runtime_target` when the id is blank.
 */
export function personalRuntimeTarget(selector: PersonalRuntimeSelector): PersonalRuntimeTarget {
  const latticeId = typeof selector === 'string' ? selector : selector.latticeId;
  const normalizedLatticeId = latticeId.trim();
  if (normalizedLatticeId.length === 0) {
    throw new LatticeError(
      0,
      'invalid_personal_runtime_target',
      'Personal runtime latticeId must be non-empty.',
    );
  }
  return {
    latticeId: normalizedLatticeId,
    model: `${PERSONAL_LATTICE_COMPATIBILITY_MODEL_ALIAS}:${normalizedLatticeId}`,
  };
}

/** Narrow an unknown JSON value to a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parse JSON without throwing; empty and malformed bodies both become `null`. */
function parseJsonOrNull(text: string): unknown {
  if (text === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Resolve a model selector down to the string the wire carries. */
function resolveModelSelector(selector: string | PersonalRuntimeTarget): string {
  return typeof selector === 'string' ? selector : selector.model;
}

/**
 * Client for the Lovelace Lattice Cloud gateway.
 *
 * @remarks
 * Upstream `LatticeClient`, trimmed to the operations Docket uses (device discovery and chat
 * dispatch). Every route path, header name and error mapping below matches upstream exactly.
 */
export class LatticeClient {
  private readonly baseUrl: string;
  private readonly credential: LatticeCredential;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly timeoutMs: number;

  /**
   * @param options - Gateway URL, credential, and optional transport overrides.
   */
  constructor(options: LatticeClientOptions) {
    this.baseUrl = (options.baseUrl ?? LATTICE_GATEWAY_BASE_URL).replace(/\/+$/, '');
    this.credential = options.credential;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * List the devices this credential may see.
   *
   * @remarks
   * With an OAuth credential this is the signed-in person's own paired devices. Requires the
   * `lattice:compute:inference` scope — reading runtime records deliberately does NOT need the
   * separate `personal_runtime:manage` authority.
   *
   * @returns Every runtime record, with live reachability overlaid.
   */
  async listPersonalRuntimes(): Promise<readonly PersonalLatticeRuntimeResource[]> {
    const body = await this.request<PersonalRuntimeListResponseBody>(
      'GET',
      '/v1/personal-runtimes',
    );
    return body.runtimes;
  }

  /**
   * List only the devices the relay currently sees.
   *
   * @returns The subset of {@link listPersonalRuntimes} whose status is `reachable`.
   */
  async listReachablePersonalRuntimes(): Promise<readonly PersonalLatticeRuntimeResource[]> {
    const runtimes = await this.listPersonalRuntimes();
    return runtimes.filter((runtime) => runtime.status === 'reachable');
  }

  /**
   * Send an OpenAI-compatible chat completion through the gateway.
   *
   * @param request - The conversation, model selector, and sampling options.
   * @returns The gateway's OpenAI-shaped completion.
   * @throws {LatticeError} On any non-2xx response or transport failure.
   */
  async chatComplete(request: ChatCompletionsRequest): Promise<OpenAiChatCompletionResponse> {
    const { idempotencyKey, maxTokens, model, ...rest } = request;
    const body: Record<string, unknown> = { ...rest, model: resolveModelSelector(model) };
    if (maxTokens !== undefined) body['max_tokens'] = maxTokens;
    return await this.request<OpenAiChatCompletionResponse>('POST', '/v1/chat/completions', {
      body,
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    });
  }

  /**
   * Send a chat completion to one specific device the user owns.
   *
   * @remarks
   * This is the call that makes "models on my own machine answer Athena" true: the request goes to
   * the hosted gateway, which seals it as relay work that the owner's daemon polls for outbound.
   *
   * @param selector - The device to run on.
   * @param request - The conversation and sampling options, without a model selector.
   * @returns The gateway's OpenAI-shaped completion.
   * @throws {PersonalRuntimeRequiresUserTokenError} When the credential is a developer API key.
   * @throws {PersonalRuntimeUnreachableError} When the device is not currently reachable.
   */
  async chatCompleteForPersonalRuntime(
    selector: PersonalRuntimeSelector,
    request: PersonalRuntimeChatCompletionsRequest,
  ): Promise<OpenAiChatCompletionResponse> {
    this.assertUserCredential();
    return await this.chatComplete({ ...request, model: personalRuntimeTarget(selector) });
  }

  /** Refuse personal-runtime dispatch on a developer key before any network call. */
  private assertUserCredential(): void {
    if (this.credential.kind !== 'oauth') throw new PersonalRuntimeRequiresUserTokenError();
  }

  /** One typed gateway request, with upstream's timeout, header and error mapping. */
  private async request<TResponse>(
    method: 'GET' | 'POST',
    path: string,
    options: LatticeRequestOptions = {},
  ): Promise<TResponse> {
    const headers = new Headers();
    headers.set('accept', 'application/json');
    this.applyAuth(headers);
    if (options.body !== undefined) headers.set('content-type', 'application/json');
    if (options.idempotencyKey !== undefined) {
      headers.set('idempotency-key', options.idempotencyKey);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: controller.signal,
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'fetch failed';
      throw new LatticeError(0, 'transport_error', message);
    } finally {
      clearTimeout(timeout);
    }

    const text = await response.text();
    const parsed = parseJsonOrNull(text);

    if (!response.ok) {
      const errorCode =
        isRecord(parsed) && typeof parsed['error'] === 'string'
          ? parsed['error']
          : `http_${response.status}`;
      const errorMessage =
        isRecord(parsed) && typeof parsed['message'] === 'string'
          ? parsed['message']
          : `Gateway returned HTTP ${response.status}`;
      if (response.status === 409 && errorCode === 'runtime_unreachable') {
        throw new PersonalRuntimeUnreachableError(parsed);
      }
      throw new LatticeError(response.status, errorCode, errorMessage, parsed);
    }

    return parsed as TResponse;
  }

  /** Apply the credential upstream's way: `x-api-key` for keys, bearer for OAuth. */
  private applyAuth(headers: Headers): void {
    if (this.credential.kind === 'apiKey') {
      headers.set('x-api-key', this.credential.apiKey);
      return;
    }
    headers.set('authorization', `Bearer ${this.credential.accessToken}`);
  }
}
