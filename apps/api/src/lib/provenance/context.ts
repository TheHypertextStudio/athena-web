/**
 * `@docket/api` — the provenance of the change in flight, without threading it through every write.
 *
 * @remarks
 * A REST route, an MCP tool, and the Athena loop all reach the same write helpers (`task-state`,
 * `task-audit`, the change-set recorder). Only the entry point knows which door the change came
 * through, and the helpers sit several calls below it. `AsyncLocalStorage` scopes that answer to
 * one in-flight request, so two concurrent callers never see each other's provenance.
 *
 * Entry points set a {@link ProvenanceBase} once: the REST middleware, the MCP catalog's tool
 * wrapper, and each worker or job. Writers ask {@link originFor} for a complete origin and add
 * only what they alone know — the operation name and any session or plan link.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

import type {
  AppSurface,
  ChangeOrigin,
  ProvenanceIntegration,
  ProvenanceRef,
  ProvenanceSurface,
  RecordedOrigin,
} from '@docket/work/provenance-contract';

/** What an entry point knows about a change before the writer adds its operation name. */
export type ProvenanceBase = Omit<RecordedOrigin, 'tool' | 'v'>;

/** What a writer adds to the entry point's provenance. */
export type OriginDetail = Pick<ChangeOrigin, 'sessionId' | 'planId' | 'planOwnerUserId' | 'ref'>;

/** Raised when a change is recorded with no entry point having declared where it came from. */
export class MissingProvenanceError extends Error {
  constructor(tool: string) {
    super(`Change "${tool}" was recorded outside any provenance scope`);
    this.name = 'MissingProvenanceError';
  }
}

const storage = new AsyncLocalStorage<ProvenanceBase>();

/**
 * Run `fn` with `base` as the provenance of every change it records.
 *
 * @param base - Where the changes come from.
 * @param fn - The work to run inside the scope.
 * @returns whatever `fn` returns.
 */
export function runWithProvenance<T>(base: ProvenanceBase, fn: () => T): T {
  return storage.run(base, fn);
}

/**
 * The provenance of the change in flight, or null outside any scope.
 *
 * @returns the current base, or null.
 */
export function currentProvenance(): ProvenanceBase | null {
  return storage.getStore() ?? null;
}

/**
 * Build the complete origin for one recorded operation.
 *
 * @param tool - The operation name. Machine-only.
 * @param detail - Session, plan, or cause links only this writer knows.
 * @param base - Explicit provenance; defaults to the current scope.
 * @returns the origin to store.
 * @throws {MissingProvenanceError} When there is neither an explicit base nor a current scope.
 */
export function originFor(
  tool: string,
  detail: OriginDetail = {},
  base: ProvenanceBase | null = currentProvenance(),
): RecordedOrigin {
  if (!base) throw new MissingProvenanceError(tool);
  const ref = base.ref || detail.ref ? { ...base.ref, ...detail.ref } : undefined;
  return { ...base, ...detail, ...(ref ? { ref } : {}), v: 2, tool };
}

/**
 * The origin to stamp on a best-effort activity row, or null outside any scope.
 *
 * @remarks
 * Activity rows are written best-effort beside a mutation that has already been applied, so a
 * missing scope leaves the row without an origin instead of failing the write. Change sets are
 * the strict record; see {@link originFor}.
 *
 * @param tool - The operation name.
 * @returns the origin, or null.
 */
export function auditOrigin(tool: string): RecordedOrigin | null {
  const base = currentProvenance();
  return base ? originFor(tool, {}, base) : null;
}

/** A person working in the Docket app. */
export function appProvenance(surface?: AppSurface): ProvenanceBase {
  return { channel: 'app', ...(surface ? { surface } : {}), performer: { kind: 'person' } };
}

/** Athena working for its owner. */
export function athenaProvenance(surface: ProvenanceSurface, sessionId?: string): ProvenanceBase {
  return {
    channel: 'athena',
    surface,
    performer: { kind: 'athena', name: 'Athena' },
    ...(sessionId ? { sessionId } : {}),
  };
}

/** The MCP or API client identity a caller presented. */
export interface ClientIdentity {
  readonly name: string;
  readonly id?: string;
  readonly version?: string;
  /** The agent actor behind a registered agent, when there is one. */
  readonly agentActorId?: string;
}

/** A third-party client calling over MCP or the REST API. */
export function clientProvenance(channel: 'mcp' | 'api', client: ClientIdentity): ProvenanceBase {
  return {
    channel,
    performer: {
      kind: 'agent',
      name: client.name,
      ...(client.agentActorId ? { actorId: client.agentActorId } : {}),
    },
    client: client.name,
    ...(client.id ? { clientId: client.id } : {}),
    ...(client.version ? { clientVersion: client.version } : {}),
  };
}

/** A rule Docket runs on a schedule or trigger. */
export function ruleProvenance(
  surface: 'recurrence' | 'routing' | 'cycle_roll' | 'calendar_link' | 'time_anchor',
  ref?: ProvenanceRef,
): ProvenanceBase {
  return {
    channel: 'rule',
    surface,
    performer: { kind: 'docket', name: 'Docket' },
    ...(ref ? { ref } : {}),
  };
}

/** A connected tool's ongoing sync, or a one-time import from one. */
export function integrationProvenance(
  channel: 'sync' | 'import',
  integration: ProvenanceIntegration,
): ProvenanceBase {
  return {
    channel,
    performer: { kind: 'docket', name: integration.provider },
    integration,
  };
}

/** An email to the Athena inbox, accepted as work. */
export function emailProvenance(messageId?: string): ProvenanceBase {
  return {
    channel: 'email',
    performer: { kind: 'athena', name: 'Athena' },
    ...(messageId ? { ref: { messageId } } : {}),
  };
}
