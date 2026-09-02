/**
 * `@docket/api` — a {@link DayBoundaryPort} backed by a real remote MCP client.
 *
 * @remarks
 * This adapter is written against the shapes a shipped boundary client actually has, and those
 * shapes disagree with each other in two ways worth stating plainly, because both drive code
 * here rather than being footnotes:
 *
 * 1. **The submit tool takes a reason and nothing else.** Its published argument schema is
 *    `{ reason: string }`, minimum one character, maximum five hundred — there is no duration
 *    argument anywhere on the wire. How much extension a grant is worth is the boundary client's
 *    own setting, not Docket's to name. So `BoundaryExtensionRequest.minutes` is Docket's
 *    *self-imposed ceiling on what it will ask for*, recorded on Docket's side and folded into
 *    the human-readable reason; it is not a number the other side is asked to honour. Pretending
 *    otherwise would be inventing a wire field.
 * 2. **The published output schemas and the shipped implementation disagree.** The schema
 *    declares structured output (`{ request_id }`, `{ status }`); the shipped implementation
 *    returns prose text (`"Extension request queued (ID: …)"`, `"Status: pending"`). Rather than
 *    pick a winner, {@link readRequestId} and {@link readOutcome} accept both — structured
 *    content when it is there, the documented prose when it is not — so this adapter keeps
 *    working whichever side converges on the other.
 *
 * **No product name appears in this file, by construction.** Per
 * `docs/engineering/specs/curfew-integration.md` §0, Docket's code does not name the client it
 * talks to; both tool names arrive as configuration ({@link McpDayBoundaryConfig}), which is also
 * the only way a second, unrelated boundary client could ever use this adapter unchanged.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import type {
  BoundaryExtensionRequest,
  BoundaryRequestOutcome,
  BoundaryRequestState,
  BoundarySubmission,
  DayBoundaryPort,
} from './port';

/** The published maximum length of the submit tool's `reason` argument. */
const MAX_REASON_LENGTH = 500;

/** How this adapter reaches a tool. Injected so the mapping is testable without a network. */
export type BoundaryToolCaller = (
  name: string,
  args: Record<string, unknown>,
) => Promise<CallToolResult>;

/** Everything the adapter needs, all of it configuration rather than a hard-coded product. */
export interface McpDayBoundaryConfig {
  /** The tool that queues a consent-gated extension request. */
  readonly submitToolName: string;
  /** The tool that reports what became of a queued request. */
  readonly statusToolName: string;
  /** How to invoke a tool. */
  readonly call: BoundaryToolCaller;
}

/** Concatenate a tool result's text blocks. */
function resultText(result: CallToolResult): string {
  return result.content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

/** The structured payload when the tool returned one, else null. */
function structured(result: CallToolResult): Record<string, unknown> | null {
  const value: unknown = result.structuredContent;
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  // The prose implementations return one text block; some hosts put JSON in it instead.
  try {
    const parsed: unknown = JSON.parse(resultText(result));
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Prose, as shipped. The prose readers below take over.
  }
  return null;
}

/** A canonical UUID anywhere in a string — how the prose form carries its request id. */
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Pull the claim ticket out of whichever shape the submit tool answered in.
 *
 * @param result - The tool result.
 * @returns the request id.
 * @throws When neither shape carried one — nothing was queued that Docket can poll for.
 */
export function readRequestId(result: CallToolResult): string {
  const payload = structured(result);
  const id: unknown = payload?.['request_id'];
  if (typeof id === 'string' && id.length > 0) return id;
  const matched = UUID_PATTERN.exec(resultText(result));
  if (matched !== null) return matched[0];
  throw new Error('boundary client returned no request id');
}

/** The published request states, and the only strings the prose form puts after `Status:`. */
const WIRE_STATES: Readonly<Record<string, BoundaryRequestState>> = Object.freeze({
  pending: 'pending',
  approved: 'approved',
  denied: 'denied',
});

/** `Status: denied` / `Denial reason: …`, the shipped prose form. */
const STATUS_LINE = /^\s*status:\s*([a-z_]+)\s*$/im;
const DENIAL_LINE = /^\s*denial reason:\s*(.+)$/im;

/**
 * Read one poll's answer out of whichever shape the status tool answered in.
 *
 * @remarks
 * An unrecognized answer — including the documented "not found (may have been pruned)" reply —
 * maps to `unavailable` rather than to a terminal state, because "Docket could not learn the
 * answer" and "the person said no" are different facts and only one of them should stop a
 * request from ever being retried. A pruned request therefore ages out through the caller's own
 * expiry rather than being recorded as a refusal that never happened.
 *
 * **`budget_exhausted` is never synthesized here.** The published status vocabulary is exactly
 * `pending | approved | denied`, with no machine-readable budget signal, and the denial note is
 * free prose. Guessing at exhaustion by matching English would be inventing a wire field, so
 * this adapter reports `denied` and carries the note in `detail`. Loop safety does not depend on
 * the distinction — the caller treats every terminal state as "do not retry" — and a port that
 * *can* report exhaustion gets the stronger, whole-day behaviour for free.
 *
 * @param result - The tool result.
 * @returns the state and whatever the client said about it.
 */
export function readOutcome(result: CallToolResult): BoundaryRequestOutcome {
  const payload = structured(result);
  const text = resultText(result);
  const detail = readDenialDetail(payload, text);
  const state = WIRE_STATES[readRawStatus(payload, text)] ?? 'unavailable';
  if (state !== 'unavailable') return { state, detail };
  // An unrecognized answer carries no denial note, so the whole reply is the only detail there
  // is — keeping it is what makes a pruned or malformed response diagnosable after the fact.
  const whole = text.trim();
  return { state, detail: detail ?? (whole.length > 0 ? whole : null) };
}

/** The denial note, preferring the structured field over the prose line. */
function readDenialDetail(payload: Record<string, unknown> | null, text: string): string | null {
  const structuredDetail: unknown = payload?.['denial_reason'];
  if (typeof structuredDetail === 'string' && structuredDetail.length > 0) return structuredDetail;
  return DENIAL_LINE.exec(text)?.[1]?.trim() ?? null;
}

/** The wire status, lower-cased, preferring the structured field over the prose line. */
function readRawStatus(payload: Record<string, unknown> | null, text: string): string {
  const structuredStatus: unknown = payload?.['status'];
  if (typeof structuredStatus === 'string') return structuredStatus;
  return (STATUS_LINE.exec(text)?.[1] ?? '').toLowerCase();
}

/**
 * A boundary port that speaks MCP to a configured pair of tools.
 *
 * @remarks
 * Stateless beyond its configuration: every call is one tool invocation, so a dropped connection
 * costs one pass rather than a session.
 */
export class McpDayBoundaryPort implements DayBoundaryPort {
  readonly #config: McpDayBoundaryConfig;

  /** @param config - The tool names and the caller to reach them through. */
  constructor(config: McpDayBoundaryConfig) {
    this.#config = config;
  }

  /** {@inheritDoc DayBoundaryPort.submitExtensionRequest} */
  async submitExtensionRequest(request: BoundaryExtensionRequest): Promise<BoundarySubmission> {
    // `reason` is the only argument the wire has; the bound travels inside it as prose because
    // there is nowhere else for it to go. See this module's remarks.
    const reason = request.reason.slice(0, MAX_REASON_LENGTH);
    const result = await this.#config.call(this.#config.submitToolName, { reason });
    if (result.isError === true) {
      throw new Error('boundary client refused the extension request call');
    }
    return { requestId: readRequestId(result) };
  }

  /** {@inheritDoc DayBoundaryPort.pollExtensionRequest} */
  async pollExtensionRequest(requestId: string): Promise<BoundaryRequestOutcome> {
    const result = await this.#config.call(this.#config.statusToolName, {
      request_id: requestId,
    });
    if (result.isError === true) return { state: 'unavailable', detail: null };
    return readOutcome(result);
  }
}

/** Where a remote boundary client lives, and how to authenticate to it. */
export interface McpDayBoundaryEndpoint {
  readonly url: string;
  readonly bearerToken?: string | undefined;
  readonly submitToolName: string;
  readonly statusToolName: string;
}

/**
 * Build a network-backed boundary port.
 *
 * @param endpoint - Where the client lives and which tools to call.
 * @returns a port that opens one short-lived MCP session per call.
 */
/* v8 ignore start -- @preserve live network edge; the mapping it delegates to is covered */
export function createMcpDayBoundaryPort(endpoint: McpDayBoundaryEndpoint): DayBoundaryPort {
  const call: BoundaryToolCaller = async (name, args) => {
    const transport = new StreamableHTTPClientTransport(new URL(endpoint.url), {
      ...(endpoint.bearerToken
        ? { requestInit: { headers: { authorization: `Bearer ${endpoint.bearerToken}` } } }
        : {}),
    });
    const client = new Client({ name: 'docket-athena-boundary', version: '1.0.0' });
    await client.connect(transport as Transport);
    try {
      return (await client.callTool({ name, arguments: args })) as CallToolResult;
    } finally {
      await client.close();
    }
  };
  return new McpDayBoundaryPort({
    submitToolName: endpoint.submitToolName,
    statusToolName: endpoint.statusToolName,
    call,
  });
}
/* v8 ignore stop */
