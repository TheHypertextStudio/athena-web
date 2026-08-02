/**
 * `@docket/integrations` — Docket's use of the Lattice gateway: discover the person's devices, and
 * run one model turn on the device they chose.
 *
 * @remarks
 * ## The invariant this module exists to hold
 *
 * When someone points Athena at their own machine, "my machine answered" must be either true or
 * visibly false — never quietly false. So every failure here resolves to a
 * {@link LatticeUnavailableReason}, and **no failure resolves to "use a cloud model instead"**.
 * The gateway itself is built the same way: `PersonalRuntimeUnreachableError` is terminal upstream
 * and is never retried onto shared capacity. This module preserves that all the way to the caller.
 *
 * ## Codes, never prose
 *
 * Everything crossing this boundary is a stable code. The gateway's `message`, an OAuth issuer's
 * `error_description`, and a DNS failure's text are all provider-owned strings; they are recorded
 * for operators and never handed to a surface. Copy for each reason lives in the web layer.
 *
 * @see {@link ./lattice-sdk.ts} for the client, and `docs/engineering/specs/lattice-byo-model.md`
 * for the end-to-end design.
 */
import {
  LatticeClient,
  LatticeError,
  PersonalRuntimeRequiresUserTokenError,
  PersonalRuntimeUnreachableError,
  type OpenAiChatCompletionResponse,
  type OpenAiChatMessage,
  type PersonalLatticeRuntimeResource,
  type PersonalLatticeRuntimeStatus,
} from './lattice-sdk';

/**
 * Why Athena cannot currently run a turn on the person's own device.
 *
 * @remarks
 * Every arm is actionable by a person, which is the test for whether a reason deserves to exist:
 *
 * - `not_connected` — no Lovelace grant yet. Connect.
 * - `no_device_selected` — grant exists, but no device is chosen. Choose one.
 * - `device_offline` — the chosen device is not reachable right now. Wake it, or start its daemon.
 * - `device_unpaired` — the record exists but no daemon ever paired with it. Run the pairing command.
 * - `device_revoked` — the device was disabled on the Lovelace account. Pick another.
 * - `device_missing` — the chosen device no longer exists on the account. Pick another.
 * - `authorization_expired` — the grant was revoked or the refresh failed. Reconnect.
 * - `insufficient_scopes` — the grant is narrower than Athena needs. Reconnect and approve.
 * - `gateway_unreachable` — Docket could not reach Lovelace at all (DNS, TLS, timeout).
 * - `gateway_error` — Lovelace answered with something Docket cannot act on.
 */
export type LatticeUnavailableReason =
  | 'not_connected'
  | 'no_device_selected'
  | 'device_offline'
  | 'device_unpaired'
  | 'device_revoked'
  | 'device_missing'
  | 'authorization_expired'
  | 'insufficient_scopes'
  | 'gateway_unreachable'
  | 'gateway_error';

/** Every {@link LatticeUnavailableReason}, for exhaustive handling and tests. */
export const LATTICE_UNAVAILABLE_REASONS: readonly LatticeUnavailableReason[] = [
  'not_connected',
  'no_device_selected',
  'device_offline',
  'device_unpaired',
  'device_revoked',
  'device_missing',
  'authorization_expired',
  'insufficient_scopes',
  'gateway_unreachable',
  'gateway_error',
];

/**
 * A Lattice operation that could not run, carrying a code a surface can branch on.
 *
 * @remarks
 * `detail` is provider text kept for operator logs. It must never be rendered.
 */
export class LatticeUnavailableError extends Error {
  /** The actionable reason. */
  readonly reason: LatticeUnavailableReason;
  /** Provider-owned diagnostic text. Never rendered to a person. */
  readonly detail: string | null;

  /**
   * @param reason - The actionable reason.
   * @param detail - Provider-owned diagnostic text, for operator logs only.
   */
  constructor(reason: LatticeUnavailableReason, detail: string | null = null) {
    super(`Lattice unavailable: ${reason}`);
    this.name = 'LatticeUnavailableError';
    this.reason = reason;
    this.detail = detail;
  }
}

/** One of the person's paired devices, in the shape Docket's surfaces render. */
export interface LatticeDevice {
  /** Gateway id for the device. */
  readonly id: string;
  /** The name its owner gave it. */
  readonly name: string;
  /** Live reachability as of this read. */
  readonly status: PersonalLatticeRuntimeStatus;
  /** True exactly when a turn dispatched right now could run. */
  readonly ready: boolean;
  /** ISO-8601 time the relay last saw the device, when it ever has. */
  readonly lastSeenAt: string | null;
  /** Which runtime family serves the work. */
  readonly executionBackend: string;
}

/** How to reach the gateway as one particular person. */
export interface LatticeGatewayContext {
  /** The person's OAuth access token. */
  readonly accessToken: string;
  /** Gateway base URL override, for a staging gateway or a local harness. */
  readonly baseUrl?: string;
  /** Injected fetch, for tests. */
  readonly fetch?: typeof globalThis.fetch;
  /** Request timeout override. */
  readonly timeoutMs?: number;
}

/** One model turn to run on a chosen device. */
export interface LatticeChatRequest {
  /** The device to run on. */
  readonly deviceId: string;
  /** The conversation, already flattened to the gateway's text-only message shape. */
  readonly messages: readonly OpenAiChatMessage[];
  /** Output token ceiling. */
  readonly maxTokens?: number;
  /** Sampling temperature. */
  readonly temperature?: number;
  /** Stable key so a retried dispatch is not executed twice on the device. */
  readonly idempotencyKey?: string;
}

/** Build the SDK client for one person's grant. */
function clientFor(context: LatticeGatewayContext): LatticeClient {
  return new LatticeClient({
    credential: { kind: 'oauth', accessToken: context.accessToken },
    ...(context.baseUrl === undefined ? {} : { baseUrl: context.baseUrl }),
    ...(context.fetch === undefined ? {} : { fetch: context.fetch }),
    ...(context.timeoutMs === undefined ? {} : { timeoutMs: context.timeoutMs }),
  });
}

/**
 * Map a device's lifecycle state onto the reason a turn cannot run on it.
 *
 * @param status - The gateway's live status for the device.
 * @returns The reason, or `null` when the device can serve a turn.
 */
export function deviceUnavailableReason(
  status: PersonalLatticeRuntimeStatus,
): LatticeUnavailableReason | null {
  switch (status) {
    case 'reachable':
      return null;
    case 'offline':
      return 'device_offline';
    case 'unpaired':
      return 'device_unpaired';
    case 'revoked':
      return 'device_revoked';
  }
}

/**
 * Translate any thrown value from the SDK into an actionable reason.
 *
 * @remarks
 * The mapping is over the gateway's documented, stable error codes — never over message text.
 * Anything unrecognized becomes `gateway_error` rather than being guessed at, because a wrong
 * guess here would tell someone to take an action that cannot help.
 *
 * @param cause - The value the SDK threw.
 * @returns The error to surface, with the provider text preserved for operator logs.
 */
export function toLatticeUnavailable(cause: unknown): LatticeUnavailableError {
  if (cause instanceof LatticeUnavailableError) return cause;
  if (cause instanceof PersonalRuntimeUnreachableError) {
    return new LatticeUnavailableError('device_offline', cause.message);
  }
  if (cause instanceof PersonalRuntimeRequiresUserTokenError) {
    // Docket only ever builds an OAuth credential, so reaching here means the stored grant was
    // dropped between load and use. "Reconnect" is the action that fixes it.
    return new LatticeUnavailableError('authorization_expired', cause.message);
  }
  if (cause instanceof LatticeError) {
    switch (cause.code) {
      case 'transport_error':
        return new LatticeUnavailableError('gateway_unreachable', cause.message);
      case 'revoked_grant':
        return new LatticeUnavailableError('authorization_expired', cause.message);
      case 'insufficient_scopes':
        return new LatticeUnavailableError('insufficient_scopes', cause.message);
      case 'personal_lattice_not_found':
        return new LatticeUnavailableError('device_missing', cause.message);
      case 'personal_lattice_relay_unavailable':
      case 'personal_lattice_execution_timeout':
      case 'runtime_unreachable':
        return new LatticeUnavailableError('device_offline', cause.message);
      default:
        break;
    }
    // 401/403 that carried no recognized code still mean "this grant will not work again";
    // telling someone to reconnect is the only action that can resolve it.
    if (cause.status === 401 || cause.status === 403) {
      return new LatticeUnavailableError('authorization_expired', cause.message);
    }
    return new LatticeUnavailableError('gateway_error', cause.message);
  }
  return new LatticeUnavailableError(
    'gateway_error',
    cause instanceof Error ? cause.message : 'unknown Lattice failure',
  );
}

/** Project a gateway runtime record into the shape Docket's surfaces render. */
function toDevice(runtime: PersonalLatticeRuntimeResource): LatticeDevice {
  return {
    id: runtime.latticeId,
    name: runtime.displayName,
    status: runtime.status,
    ready: runtime.status === 'reachable',
    lastSeenAt: runtime.lastSeenAt ?? null,
    executionBackend: runtime.executionBackend,
  };
}

/**
 * List every device the person has paired with their Lovelace account.
 *
 * @remarks
 * Revoked devices are included on purpose: a picker that silently drops the device someone
 * selected leaves them staring at an empty list with no explanation of where it went.
 *
 * @param context - The person's grant and gateway target.
 * @returns Their devices, newest-reachable-first order preserved from the gateway.
 * @throws {LatticeUnavailableError} When the gateway cannot be read.
 */
export async function listLatticeDevices(
  context: LatticeGatewayContext,
): Promise<readonly LatticeDevice[]> {
  try {
    const runtimes = await clientFor(context).listPersonalRuntimes();
    return runtimes.map(toDevice);
  } catch (cause) {
    throw toLatticeUnavailable(cause);
  }
}

/**
 * Read one device's live state.
 *
 * @param context - The person's grant and gateway target.
 * @param deviceId - The device to read.
 * @returns The device, or `null` when the account no longer has it.
 * @throws {LatticeUnavailableError} When the gateway cannot be read.
 */
export async function readLatticeDevice(
  context: LatticeGatewayContext,
  deviceId: string,
): Promise<LatticeDevice | null> {
  const devices = await listLatticeDevices(context);
  return devices.find((device) => device.id === deviceId) ?? null;
}

/**
 * Run one model turn on the chosen device.
 *
 * @remarks
 * The device's readiness is checked before dispatch so the common "my laptop is asleep" case
 * produces `device_offline` immediately rather than after the gateway's full timeout. That check
 * is an optimization, not the guarantee: the gateway's own terminal
 * `PersonalRuntimeUnreachableError` still maps to the same reason if the device drops between the
 * check and the dispatch.
 *
 * @param context - The person's grant and gateway target.
 * @param request - The device, conversation and sampling options.
 * @returns The gateway's OpenAI-shaped completion.
 * @throws {LatticeUnavailableError} With a reason a person can act on; never a silent fallback.
 */
export async function runLatticeChat(
  context: LatticeGatewayContext,
  request: LatticeChatRequest,
): Promise<OpenAiChatCompletionResponse> {
  const client = clientFor(context);
  let device: LatticeDevice | null;
  try {
    const runtimes = await client.listPersonalRuntimes();
    device = runtimes.map(toDevice).find((candidate) => candidate.id === request.deviceId) ?? null;
  } catch (cause) {
    throw toLatticeUnavailable(cause);
  }
  if (!device) throw new LatticeUnavailableError('device_missing');
  const blocked = deviceUnavailableReason(device.status);
  if (blocked) throw new LatticeUnavailableError(blocked);

  try {
    return await client.chatCompleteForPersonalRuntime(request.deviceId, {
      messages: request.messages,
      ...(request.maxTokens === undefined ? {} : { maxTokens: request.maxTokens }),
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      ...(request.idempotencyKey === undefined ? {} : { idempotencyKey: request.idempotencyKey }),
    });
  } catch (cause) {
    throw toLatticeUnavailable(cause);
  }
}
