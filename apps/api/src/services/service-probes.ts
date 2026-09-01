/**
 * `@docket/api` — the service-health probe runner.
 *
 * @remarks
 * Docket carries no observability stack, so nothing has ever recorded whether a dependency
 * answered. These probes are that record: a scheduled pass writes one row per service to
 * `service_probe`, whether the check passed or failed, because uptime is a ratio and only recording
 * the passes measures nothing.
 *
 * ## What this file may touch
 *
 * Only our own health endpoints and our own database. It holds no provider credential and issues no
 * authenticated third-party request. An earlier draft read `STRIPE_SECRET_KEY`, `ANTHROPIC_API_KEY`,
 * and `RESEND_API_KEY` straight into this module to ping each provider — which spread three secrets
 * into a file that has no business holding any of them, when each provider already has an adapter
 * that owns its credential.
 *
 * Third-party health is therefore *derived*, not pinged: it is read from the ledgers that already
 * record real provider traffic. That is also the more truthful signal. A synthetic ping that
 * succeeds while every real charge is failing is precisely the "reports success when nothing
 * happened" failure this codebase forbids, and a ping cannot detect it. What is lost is a signal for
 * a provider with no recent traffic, which is reported as exactly that rather than as healthy.
 *
 * ## What this file may store
 *
 * A closed set of application-owned failure reasons, never a provider's error text. Those strings
 * are uncontrolled input — they can carry request URLs, echoed headers, or account identifiers —
 * and this value is persisted and then rendered in the operator console.
 */
import { db, serviceProbe } from '@docket/db';
import { lt } from 'drizzle-orm';

import { type ProbeOutcomeDto, type ProbeReasonDto } from '../admin-dto';
import { env } from '../env';
import { checkDatabase } from '../routes/health';
import { readServiceControl } from './service-controls';
import { WORK_LEDGERS, readLedgerWindow, type LedgerWindow, type WorkLedger } from './work-ledgers';

/** How long any single check may take before it counts as unreachable. */
const PROBE_TIMEOUT_MS = 5_000;

/** How far back a derived check looks for real provider traffic. */
export const DERIVED_WINDOW_MS = 60 * 60 * 1000;

/**
 * How long a recorded check is kept.
 *
 * @remarks
 * Matches the longest window the status board reports, because a row older than that answers no
 * question anyone can ask. Without a horizon this table is the one thing on the branch that grows
 * without bound — roughly 841,000 rows a year at the scheduled cadence — and it has no owning
 * organization to cascade from, so nothing else would ever remove a row.
 */
export const PROBE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * What a probe concluded.
 *
 * @remarks
 * Derived from the response DTO rather than re-typed, so the runner cannot write an outcome the
 * board is unable to serve. The same closed set also exists as the `probe_outcome` pgEnum, which is
 * what makes an unknown value fail at the insert rather than at the far end of a request.
 */
type ProbeOutcome = ProbeOutcomeDto;

/**
 * Why a check did not succeed, in application-owned words.
 *
 * @remarks
 * A closed set precisely so no provider or exception text is ever stored or shown. Derived from the
 * response DTO for the same reason as {@link ProbeOutcome}: two hand-maintained copies of one
 * vocabulary drift, and `reason` is stored as plain text, so nothing else would catch it.
 */
type ProbeReason = ProbeReasonDto;

/** Whether a service is ours to fix or someone else's. */
type ServiceKind = 'platform' | 'dependency';

/** How a service's health is established. */
type ProbeMethod = 'http' | 'database' | 'derived';

/**
 * What one scheduled pass did.
 *
 * @remarks
 * A discriminated result rather than a possibly-empty list, so a caller cannot mistake "switched
 * off" for "checked everything and found nothing wrong".
 */
export type ProbePass =
  | { readonly ran: false; readonly reason: 'probing_disabled' }
  | { readonly ran: true; readonly results: readonly ProbeResult[]; readonly pruned: number };

/** The result of checking one service, before it is written. */
export interface ProbeResult {
  readonly serviceKey: string;
  readonly outcome: ProbeOutcome;
  readonly latencyMs: number;
  readonly statusCode: number | null;
  readonly reason: ProbeReason | null;
}

/** One entry in the probe catalogue. */
export interface ProbeTarget {
  /** Stable key stored on every row for this service. */
  readonly key: string;
  /** What an operator calls it. */
  readonly label: string;
  /** Ours or a third party's. */
  readonly kind: ServiceKind;
  /** How this service's health is established. */
  readonly method: ProbeMethod;
  /** The health URL, for `http` targets that this deployment has configured. */
  readonly url?: string | undefined;
  /**
   * The ledger a `derived` target reads.
   *
   * @remarks
   * Held on the target rather than in a lookup keyed by service name, so the catalogue is the only
   * place that knows which ledger answers for which dependency.
   */
  readonly ledger?: WorkLedger | undefined;
}

/** Find one ledger by key, so a target can name the work that answers for it. */
function ledger(key: string): WorkLedger {
  const found = WORK_LEDGERS.find((entry) => entry.key === key);
  // Unreachable with the catalogue below, and a loud failure at import beats a silent `unknown`
  // row for a dependency an operator believes is being watched.
  if (!found) throw new Error(`No work ledger named ${key}.`);
  return found;
}

/** Join an origin and a path without doubling or dropping the separator. */
function healthUrl(origin: string | undefined, path: string): string | undefined {
  if (!origin) return undefined;
  return `${origin.replace(/\/+$/, '')}${path}`;
}

/**
 * Every service this deployment depends on, in the order an operator should read them.
 *
 * @remarks
 * Deployment topology, not an operator setting: a ninth service needs a check implementation
 * either way, and the URLs are deployment facts the environment already carries. Whether probing
 * runs at all *is* an operator setting, and lives in `service_control`.
 */
export const PROBE_TARGETS: readonly ProbeTarget[] = [
  {
    key: 'api',
    label: 'API',
    kind: 'platform',
    method: 'http',
    url: healthUrl(env.API_URL, '/v1/health'),
  },
  {
    key: 'web',
    label: 'Web app',
    kind: 'platform',
    method: 'http',
    url: healthUrl(env.WEB_URL, '/healthz'),
  },
  {
    key: 'admin',
    label: 'Operator console',
    kind: 'platform',
    method: 'http',
    url: healthUrl(env.ADMIN_URL, '/healthz'),
  },
  {
    key: 'runner',
    label: 'Athena runner',
    kind: 'platform',
    method: 'http',
    // Production currently holds the async runner off. That is a decision, not a fault, so an
    // unconfigured runner reports `disabled` rather than paging someone.
    url: env.ATHENA_ASYNC_RUNNER_ENABLED
      ? healthUrl(env.CLOUDFLARE_ATHENA_RUNNER_URL, '/healthz')
      : undefined,
  },
  { key: 'database', label: 'Database', kind: 'platform', method: 'database' },
  {
    key: 'stripe',
    label: 'Stripe',
    kind: 'dependency',
    method: 'derived',
    ledger: ledger('billing_sync'),
  },
  {
    key: 'anthropic',
    label: 'Athena provider',
    kind: 'dependency',
    method: 'derived',
    ledger: ledger('agent_runs'),
  },
  {
    key: 'connectors',
    label: 'Connector syncs',
    kind: 'dependency',
    method: 'derived',
    ledger: ledger('connector_sync'),
  },
];

/**
 * Classify an HTTP response status.
 *
 * @remarks
 * A non-2xx from one of our own health endpoints is `down`: these endpoints are unauthenticated and
 * exist only to answer this question, so there is no credential to blame.
 *
 * @param status - The response status.
 * @returns the outcome that status implies.
 */
function outcomeForStatus(status: number): ProbeOutcome {
  return status >= 200 && status < 300 ? 'up' : 'down';
}

/**
 * Check one of our own services over HTTP.
 *
 * @param target - The service to check.
 * @param fetchImpl - The fetch to use. Injectable so tests never reach the network.
 * @returns what the check concluded, with the time it took.
 */
async function probeHttp(target: ProbeTarget, fetchImpl: typeof fetch): Promise<ProbeResult> {
  const started = Date.now();

  try {
    const response = await fetchImpl(target.url ?? '', {
      method: 'GET',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      redirect: 'manual',
    });
    // Nothing reads the body, and an unconsumed one pins its socket out of the pool until GC.
    await response.body?.cancel();
    const outcome = outcomeForStatus(response.status);
    return {
      serviceKey: target.key,
      outcome,
      latencyMs: Date.now() - started,
      statusCode: response.status,
      reason: outcome === 'up' ? null : 'bad_status',
    };
  } catch {
    // A check that throws is a check that failed, and it is recorded as one. The thrown value is
    // deliberately not read: an absent row would read as "never checked", and the message would be
    // provider text in a field the console renders.
    return {
      serviceKey: target.key,
      outcome: 'down',
      latencyMs: Date.now() - started,
      statusCode: null,
      reason: 'unreachable',
    };
  }
}

/**
 * Check the database.
 *
 * @remarks
 * Delegates to the liveness route's own check rather than repeating `select 1` here, so one
 * deployment cannot give two different answers about Postgres — and so this inherits the deadline
 * that check already applies. The first draft of this function had none, which would have let a
 * hung connection stall the whole probe pass.
 *
 * @returns what the check concluded.
 */
async function probeDatabase(): Promise<ProbeResult> {
  const started = Date.now();
  const reachable = (await checkDatabase()) === 'ok';
  return {
    serviceKey: 'database',
    outcome: reachable ? 'up' : 'down',
    latencyMs: Date.now() - started,
    statusCode: null,
    reason: reachable ? null : 'unreachable',
  };
}

/**
 * Turn a window of real provider traffic into a health verdict.
 *
 * @remarks
 * No traffic is reported as `unknown` with a `no_recent_activity` reason rather than as `up`.
 * Claiming a provider is healthy because nothing asked it anything is the exact failure mode this
 * codebase forbids of connectors.
 *
 * @param key - The service key to report under.
 * @param window - What the ledger recorded.
 * @param startedAt - When the check began, for the latency figure.
 * @returns the verdict.
 */
function verdictFromTraffic(key: string, window: LedgerWindow, startedAt: number): ProbeResult {
  const latencyMs = Date.now() - startedAt;
  if (window.total === 0) {
    return {
      serviceKey: key,
      outcome: 'unknown',
      latencyMs,
      statusCode: null,
      reason: 'no_recent_activity',
    };
  }
  if (window.failed === 0) {
    return { serviceKey: key, outcome: 'up', latencyMs, statusCode: null, reason: null };
  }
  // Some traffic is succeeding, so the provider is reachable and something is wrong with it.
  const outcome: ProbeOutcome = window.failed === window.total ? 'down' : 'degraded';
  return { serviceKey: key, outcome, latencyMs, statusCode: null, reason: 'recent_failures' };
}

/**
 * Establish a third party's health from the traffic we actually sent it.
 *
 * @param target - The service to report on.
 * @returns what its ledger implies.
 */
async function probeDerived(target: ProbeTarget): Promise<ProbeResult> {
  const started = Date.now();
  if (!target.ledger) {
    return {
      serviceKey: target.key,
      outcome: 'unknown',
      latencyMs: 0,
      statusCode: null,
      reason: 'not_configured',
    };
  }
  const since = new Date(Date.now() - DERIVED_WINDOW_MS);
  return verdictFromTraffic(target.key, await readLedgerWindow(target.ledger, since), started);
}

/**
 * Check one service.
 *
 * @param target - The service to check.
 * @param fetchImpl - The fetch to use for `http` targets.
 * @returns what the check concluded.
 */
export async function probeOne(
  target: ProbeTarget,
  fetchImpl: typeof fetch = fetch,
): Promise<ProbeResult> {
  if (target.method === 'database') return probeDatabase();
  if (target.method === 'derived') return probeDerived(target);
  if (target.url === undefined) {
    return {
      serviceKey: target.key,
      outcome: 'disabled',
      latencyMs: 0,
      statusCode: null,
      reason: 'not_configured',
    };
  }
  return probeHttp(target, fetchImpl);
}

/**
 * Check every service and record what each one said.
 *
 * @remarks
 * Checks run concurrently, so the pass is bounded by the slowest single check rather than their sum
 * and one slow service cannot delay the rest.
 *
 * Respects the `service_probes` control, so an operator can stop probing from the console without a
 * redeploy. A key with no stored row reads as enabled, so probing is on by default.
 *
 * Reports whether it ran rather than returning an empty list when switched off. A pass that answered
 * `0 checked, 0 down` for a disabled deployment would read exactly like a healthy one.
 *
 * @param fetchImpl - The fetch to use. Injectable so tests never reach the network.
 * @returns what the pass did, or that it was switched off.
 */
export async function runServiceProbes(fetchImpl: typeof fetch = fetch): Promise<ProbePass> {
  if (!(await readServiceControl('service_probes'))) {
    return { ran: false, reason: 'probing_disabled' };
  }

  const results = await Promise.all(PROBE_TARGETS.map((target) => probeOne(target, fetchImpl)));

  await db.insert(serviceProbe).values(
    results.map((result) => ({
      serviceKey: result.serviceKey,
      outcome: result.outcome,
      latencyMs: result.latencyMs,
      statusCode: result.statusCode,
      reason: result.reason,
    })),
  );

  const pruned = await pruneExpiredProbes();
  return { ran: true, results, pruned };
}

/**
 * Delete recorded checks past the retention horizon.
 *
 * @remarks
 * Runs inside the probe pass rather than as its own scheduled job: the horizon only moves when a
 * pass writes, and folding it in keeps the cron catalogue and its pinned test unchanged.
 *
 * @returns how many rows were removed.
 */
async function pruneExpiredProbes(): Promise<number> {
  const removed = await db
    .delete(serviceProbe)
    .where(lt(serviceProbe.checkedAt, new Date(Date.now() - PROBE_RETENTION_MS)))
    .returning({ id: serviceProbe.id });
  return removed.length;
}
