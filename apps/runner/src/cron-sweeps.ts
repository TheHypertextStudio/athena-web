/**
 * Scheduled cron fan-out from `docket-athena-runner` to Docket API internal cron endpoints.
 *
 * @remarks
 * Replaces the 26 GCP Cloud Scheduler HTTP jobs by checking which schedules match the current
 * UTC minute inside the Worker's existing `* * * * *` cron trigger and POSTing to Docket with
 * `CRON_SECRET`. All 26 definitions match `scripts/scheduler-setup.ts` and are locked together by
 * `repo-tests/tooling/scheduler-setup.test.ts`.
 */

const ATHENA_TRIGGERS_PATH = '/internal/cron/athena-triggers';
const CRON_DISPATCH_CONCURRENCY = 4;
/** Outer deadline per individual `/internal/cron/*` request triggered from the Worker cron. */
export const DEFAULT_CRON_SWEEP_TIMEOUT_MS = 30_000;

/** Controls which API cron endpoints the Worker cron dispatches. */
export type CronMode = 'off' | 'staging-athena' | 'all';

/** One Docket API cron route and its five-field UTC cron schedule. */
export interface RunnerCronJob {
  readonly name: string;
  readonly path: string;
  readonly schedule: string;
}

/** Configuration needed when Worker cron fan-out is enabled. */
export interface CronSweepEnv {
  /** Base URL of the Docket API service. */
  readonly DOCKET_API_URL: string;
  /** Shared bearer secret checked by `/internal/cron/*` handlers. */
  readonly CRON_SECRET?: string | undefined;
  /** Dispatch scope: `off` (default), `staging-athena`, or `all`. */
  readonly DOCKET_CRON_MODE?: string | undefined;
}

/** Injectable transport and clock boundaries for cron sweep testing. */
export interface CronSweepDependencies {
  readonly fetch: typeof fetch;
  readonly timeoutMs?: number;
  readonly now?: Date;
}

/** Failure details for one dispatched cron job invocation. */
export interface CronSweepFailure {
  readonly name: string;
  readonly path: string;
  readonly status?: number;
  readonly error: string;
}

/** Aggregate result emitted in structured logs after a cron tick. */
export interface CronSweepSummary {
  readonly mode: CronMode;
  readonly due: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly failures: readonly CronSweepFailure[];
}

/**
 * The complete list of Docket API cron jobs mirrored from `scripts/scheduler-setup.ts`.
 */
export const RUNNER_CRON_JOBS: readonly RunnerCronJob[] = [
  { name: 'docket-service-probe', path: '/internal/cron/service-probe', schedule: '*/5 * * * *' },
  {
    name: 'docket-billing-reconciliation',
    path: '/internal/cron/billing-reconciliation',
    schedule: '*/15 * * * *',
  },
  {
    name: 'docket-sync-connectors',
    path: '/internal/cron/sync-connectors',
    schedule: '*/15 * * * *',
  },
  {
    name: 'docket-staff-google-sync',
    path: '/internal/cron/staff-google-sync',
    schedule: '*/15 * * * *',
  },
  {
    name: 'docket-lifecycle-sweep',
    path: '/internal/cron/lifecycle-sweep',
    schedule: '0 3 * * *',
  },
  { name: 'docket-process-events', path: '/internal/cron/process-events', schedule: '*/5 * * * *' },
  { name: 'docket-pull-activity', path: '/internal/cron/pull-activity', schedule: '*/15 * * * *' },
  { name: 'docket-daily-digests', path: '/internal/cron/daily-digests', schedule: '*/15 * * * *' },
  {
    name: 'docket-account-deletion-sweep',
    path: '/internal/cron/account-deletion-sweep',
    schedule: '30 3 * * *',
  },
  {
    name: 'docket-account-export-sweep',
    path: '/internal/cron/account-export-sweep',
    schedule: '*/10 * * * *',
  },
  {
    name: 'docket-email-suggestions',
    path: '/internal/cron/email-suggestions',
    schedule: '*/15 * * * *',
  },
  {
    name: 'docket-sync-calendars',
    path: '/internal/cron/sync-calendars',
    schedule: '*/10 * * * *',
  },
  {
    name: 'docket-sync-work-locations',
    path: '/internal/cron/sync-work-locations',
    schedule: '*/10 * * * *',
  },
  {
    name: 'docket-recurrence-materialization',
    path: '/internal/cron/recurrence-materialization',
    schedule: '*/15 * * * *',
  },
  {
    name: 'docket-run-linear-agent-sessions',
    path: '/internal/cron/run-linear-agent-sessions',
    schedule: '*/5 * * * *',
  },
  {
    name: 'docket-expired-sessions-sweep',
    path: '/internal/cron/expired-sessions-sweep',
    schedule: '0 * * * *',
  },
  { name: 'docket-usage-rollup', path: '/internal/cron/usage-rollup', schedule: '0 4 * * *' },
  {
    name: 'docket-expired-drafts-sweep',
    path: '/internal/cron/expired-drafts-sweep',
    schedule: '30 3 * * *',
  },
  { name: 'docket-athena-triggers', path: ATHENA_TRIGGERS_PATH, schedule: '* * * * *' },
  {
    name: 'docket-elicitation-deadlines',
    path: '/internal/cron/elicitation-deadlines',
    schedule: '*/5 * * * *',
  },
  { name: 'docket-search-index', path: '/internal/cron/search-index', schedule: '*/5 * * * *' },
  {
    name: 'docket-legacy-mentions',
    path: '/internal/cron/legacy-mentions',
    schedule: '15 * * * *',
  },
  {
    name: 'docket-unfurl-resources',
    path: '/internal/cron/unfurl-resources',
    schedule: '*/5 * * * *',
  },
  {
    name: 'docket-document-image-cleanup',
    path: '/internal/cron/document-image-cleanup',
    schedule: '37 4 * * *',
  },
  {
    name: 'docket-directive-posture',
    path: '/internal/cron/directive-posture',
    schedule: '*/5 * * * *',
  },
  { name: 'docket-day-cadence', path: '/internal/cron/day-cadence', schedule: '*/5 * * * *' },
] as const;

/**
 * Parse the configured `DOCKET_CRON_MODE` string into a strict {@link CronMode}.
 *
 * @param raw - Raw Worker environment value.
 * @returns `'off'` when omitted, or the validated mode.
 * @throws when a non-empty value is outside the allowed set.
 */
export function resolveCronMode(raw?: string): CronMode {
  if (!raw) return 'off';
  if (raw === 'off' || raw === 'staging-athena' || raw === 'all') return raw;
  throw new Error(`Invalid DOCKET_CRON_MODE: ${raw}`);
}

function parseCronInt(token: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(token)) return null;
  const parsed = Number(token);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

function parseCronRange(rangeText: string, min: number, max: number): [number, number] | null {
  if (rangeText === '*') return [min, max];
  if (!rangeText.includes('-')) {
    const exact = parseCronInt(rangeText, min, max);
    return exact === null ? null : [exact, exact];
  }
  const parts = rangeText.split('-');
  if (parts.length !== 2) return null;
  const start = parseCronInt(parts[0] ?? '', min, max);
  const end = parseCronInt(parts[1] ?? '', min, max);
  if (start === null || end === null || start > end) return null;
  return [start, end];
}

function matchesCronPart(part: string, value: number, min: number, max: number): boolean {
  const segments = part.split('/');
  if (segments.length > 2) return false;
  const bounds = parseCronRange(segments[0] ?? '', min, max);
  if (!bounds) return false;
  const [start, end] = bounds;
  if (value < start || value > end) return false;
  if (segments.length === 1) return true;
  const step = parseCronInt(segments[1] ?? '', 1, max);
  if (step === null) return false;
  return (value - start) % step === 0;
}

function matchesCronField(field: string, value: number, min: number, max: number): boolean {
  if (!field) return false;
  return field.split(',').some((part) => matchesCronPart(part, value, min, max));
}

/**
 * Evaluate whether a standard five-field UTC cron expression matches `date`.
 *
 * @param schedule - Five-field cron expression (`min hour dom month dow`).
 * @param date - UTC instant to evaluate.
 * @returns `true` when every field matches and the expression is valid.
 */
export function matchesCronSchedule(schedule: string, date: Date): boolean {
  if (Number.isNaN(date.getTime())) return false;
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const [minuteField, hourField, domField, monthField, dowField] = fields as [
    string,
    string,
    string,
    string,
    string,
  ];
  const dow = date.getUTCDay();
  const matchesDow =
    matchesCronField(dowField, dow, 0, 7) || (dow === 0 && matchesCronField(dowField, 7, 0, 7));
  return (
    matchesCronField(minuteField, date.getUTCMinutes(), 0, 59) &&
    matchesCronField(hourField, date.getUTCHours(), 0, 23) &&
    matchesCronField(domField, date.getUTCDate(), 1, 31) &&
    matchesCronField(monthField, date.getUTCMonth() + 1, 1, 12) &&
    matchesDow
  );
}

/**
 * Select all Docket cron jobs due at `now` for the active {@link CronMode}.
 *
 * @param mode - Active Worker cron mode.
 * @param now - UTC instant of the cron trigger.
 * @returns Due job definitions.
 */
export function selectDueCronJobs(mode: CronMode, now: Date): readonly RunnerCronJob[] {
  if (mode === 'off') return [];
  const candidates =
    mode === 'staging-athena'
      ? RUNNER_CRON_JOBS.filter((job) => job.path === ATHENA_TRIGGERS_PATH)
      : RUNNER_CRON_JOBS;
  return candidates.filter((job) => matchesCronSchedule(job.schedule, now));
}

async function dispatchOneCronJob(
  job: RunnerCronJob,
  baseUrl: string,
  secret: string,
  dependencies: CronSweepDependencies,
): Promise<CronSweepFailure | null> {
  const signal = AbortSignal.timeout(dependencies.timeoutMs ?? DEFAULT_CRON_SWEEP_TIMEOUT_MS);
  try {
    const response = await dependencies.fetch(new URL(job.path, baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-cron-secret': secret,
        authorization: `Bearer ${secret}`,
      },
      body: '{}',
      signal,
    });
    await response.body?.cancel().catch(() => undefined);
    if (response.ok) return null;
    return {
      name: job.name,
      path: job.path,
      status: response.status,
      error: `HTTP ${String(response.status)}`,
    };
  } catch (error) {
    const message = signal.aborted
      ? 'Cron request timed out'
      : error instanceof Error
        ? error.message
        : String(error);
    return { name: job.name, path: job.path, error: message };
  }
}

async function dispatchJobsBounded(
  jobs: readonly RunnerCronJob[],
  baseUrl: string,
  secret: string,
  dependencies: CronSweepDependencies,
): Promise<readonly CronSweepFailure[]> {
  const failures: CronSweepFailure[] = [];
  let cursor = 0;

  async function runWorker(): Promise<void> {
    while (cursor < jobs.length) {
      const job = jobs[cursor];
      cursor += 1;
      if (!job) return;
      const failure = await dispatchOneCronJob(job, baseUrl, secret, dependencies);
      if (failure) failures.push(failure);
    }
  }

  const workerCount = Math.min(CRON_DISPATCH_CONCURRENCY, jobs.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return failures;
}

/**
 * Dispatch every Docket API cron endpoint due at the current UTC minute.
 *
 * @param env - Runner environment containing `DOCKET_API_URL`, `DOCKET_CRON_MODE`, and `CRON_SECRET`.
 * @param dependencies - Injectable `fetch`, clock, and request timeout.
 * @returns Aggregate counts and per-job failures safe for structured logging.
 * @throws when `DOCKET_CRON_MODE` is invalid or enabled without `CRON_SECRET`.
 */
export async function runScheduledCronSweeps(
  env: CronSweepEnv,
  dependencies: CronSweepDependencies = { fetch },
): Promise<CronSweepSummary> {
  const mode = resolveCronMode(env.DOCKET_CRON_MODE);
  if (mode === 'off') {
    return { mode, due: 0, succeeded: 0, failed: 0, failures: [] };
  }
  const secret = env.CRON_SECRET?.trim();
  if (!secret) {
    throw new Error('Missing CRON_SECRET for Cloudflare cron sweep');
  }

  const jobs = selectDueCronJobs(mode, dependencies.now ?? new Date());
  const failures = await dispatchJobsBounded(jobs, env.DOCKET_API_URL, secret, dependencies);

  return {
    mode,
    due: jobs.length,
    succeeded: jobs.length - failures.length,
    failed: failures.length,
    failures,
  };
}
