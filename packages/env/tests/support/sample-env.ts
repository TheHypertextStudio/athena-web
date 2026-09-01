/**
 * Build a valid environment for one target, from the registry itself.
 *
 * @remarks
 * Shared because two suites need the same fixture and a second copy would have to be kept in step
 * by hand: `check-env-for-target` proves the query, and the deploy-manifest gate proves what that
 * query does to a real manifest. A drifted copy would make one of them assert against an
 * environment the other considers invalid.
 */
import { VAR_REGISTRY, type Target } from '../../src/registry';

/**
 * Values for the schemas that reject an arbitrary string.
 *
 * @remarks
 * Only the narrow ones need an entry. Everything else takes the generic filler below, which every
 * open `z.string()` accepts — including the ones carrying a minimum length.
 */
const NARROW_SAMPLES: Readonly<Record<string, string>> = {
  NODE_ENV: 'production',
  APP_MODE: 'production',
  GOOGLE_OAUTH_PUBLIC: 'false',
  ADMIN_GOOGLE_SSO_ENABLED: 'false',
  WORK_LOCATION_PROJECTION_ENABLED: 'false',
  LINEAR_AGENT_ENABLED: 'false',
  BILLING_ENABLED: 'false',
  MCP_TASKS_ENABLED: 'false',
  ATHENA_ASYNC_RUNNER_ENABLED: 'false',
  BILLING_RECONCILIATION_MODE: 'off',
  AGENT_MAX_TURNS: '8',
  PORT: '4000',
};

/** Accepted by every open string schema in the registry, including the min-length ones. */
const GENERIC_SAMPLE = 'sample-value-long-enough-for-min-length-rules';

/**
 * Every required variable for `target`, with a value its own schema accepts.
 *
 * @param target - The surface to build an environment for.
 * @param omit - Names to leave out, for a case that needs one absent.
 * @returns a fresh record, safe for the caller to mutate.
 */
export function sampleEnvForTarget(
  target: Target,
  omit: readonly string[] = [],
): Record<string, string> {
  const excluded = new Set(omit);
  const env: Record<string, string> = {};
  for (const spec of VAR_REGISTRY) {
    if (!spec.targets.includes(target) || !spec.required) continue;
    if (excluded.has(spec.name)) continue;
    env[spec.name] = NARROW_SAMPLES[spec.name] ?? GENERIC_SAMPLE;
  }
  return env;
}
