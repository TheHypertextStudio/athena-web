import { signInternalRequest } from './hmac';

const DISPATCH_SWEEP_PATH = '/internal/athena/execution/dispatch/sweep';
/** Outer deadline for a bounded sweep containing up to 25 sequential deliveries. */
export const DEFAULT_DISPATCH_SWEEP_TIMEOUT_MS = 5 * 60_000;

/** Configuration needed by Cloudflare's scheduled dispatch recovery. */
export interface DispatchSweepEnv {
  readonly CLOUDFLARE_TO_DOCKET_HMAC_SECRET: string;
  readonly DOCKET_API_URL: string;
}

/** Injectable scheduled transport for timeout and signature tests. */
export interface DispatchSweepDependencies {
  readonly fetch: typeof fetch;
  readonly timeoutMs?: number;
}

/** Aggregate recovery counts safe to emit in operational logs. */
export interface DispatchSweepResult {
  readonly claimed: number;
  readonly delivered: number;
  readonly retried: number;
  readonly failed: number;
}

function isDispatchSweepResult(value: unknown): value is DispatchSweepResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return ['claimed', 'delivered', 'retried', 'failed'].every(
    (key) => Number.isSafeInteger(record[key]) && Number(record[key]) >= 0,
  );
}

/** Invoke Docket's protected bounded outbox sweep from the Worker cron. */
export async function runDispatchSweep(
  env: DispatchSweepEnv,
  dependencies: DispatchSweepDependencies = { fetch },
): Promise<DispatchSweepResult> {
  const body = '{}';
  const headers = await signInternalRequest({
    secret: env.CLOUDFLARE_TO_DOCKET_HMAC_SECRET,
    method: 'POST',
    path: DISPATCH_SWEEP_PATH,
    body,
  });
  const signal = AbortSignal.timeout(dependencies.timeoutMs ?? DEFAULT_DISPATCH_SWEEP_TIMEOUT_MS);
  let response: Response;
  try {
    response = await dependencies.fetch(new URL(DISPATCH_SWEEP_PATH, env.DOCKET_API_URL), {
      method: 'POST',
      headers,
      body,
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw new Error('Docket dispatch sweep timed out', { cause: error });
    throw error;
  }
  if (!response.ok) {
    throw new Error(`Docket dispatch sweep failed (${String(response.status)})`);
  }
  const result: unknown = await response.json();
  if (!isDispatchSweepResult(result)) {
    throw new Error('Docket dispatch sweep returned an invalid response');
  }
  return result;
}
