/**
 * `@docket/api` — the sequencing gate that keeps the Lattice surface unreachable until Athena is
 * proven on the default routed backend.
 *
 * @remarks
 * The author's sequencing constraint is explicit: bring-your-own-Lattice ships *after* Athena is
 * shown to work on Cloudflare's model router using Docket's own API keys. A rule that lives only
 * in a plan is a rule that gets skipped, so it lives here as code the settings surface reads.
 *
 * ## What "verified" means, precisely
 *
 * {@link CLOUDFLARE_ROUTER_VERIFICATION} is a recorded fact about a run that actually happened,
 * not a boolean someone flipped. `mode` is the honest part:
 *
 * - `production-keys` — a real end-to-end run against `gateway.ai.cloudflare.com` with Docket's
 *   own credentials. This is the only mode that opens the gate in production.
 * - `harness` — the same code path exercised end to end against a recording proxy standing in for
 *   the router, because no Docket-owned credential was present in that environment. Sufficient to
 *   prove the seam and to develop against; deliberately **not** sufficient to ship.
 *
 * So in production the Lattice section stays unreachable until someone records a `production-keys`
 * run. Outside production it is reachable, because a developer with no Anthropic account still has
 * to be able to build and screenshot the feature.
 *
 * @see `docs/engineering/evidence/athena-model-backend-verification.md` for the recorded run.
 */
import { env } from '../env';

/** How thoroughly the routed default backend was exercised. */
export type ModelBackendVerificationMode = 'production-keys' | 'harness';

/** A recorded end-to-end verification of the routed default backend. */
export interface ModelBackendVerification {
  /** Which backend was exercised. */
  readonly backendId: 'cloudflare-router';
  /** Whether real Docket credentials were used, or a recording stand-in. */
  readonly mode: ModelBackendVerificationMode;
  /** ISO-8601 date of the run. */
  readonly recordedAt: string;
  /** The scenarios the run covered. */
  readonly scenarios: readonly string[];
  /** Where the run's committed output and request traces live. */
  readonly evidencePath: string;
}

/**
 * The recorded verification of Athena on Cloudflare's model router.
 *
 * @remarks
 * Produced by `apps/api/tests/lattice/verify-athena-backend.ts`, which drives real turns through
 * the real backend seam and writes its transcript and HTTP traces to
 * {@link ModelBackendVerification.evidencePath}. That script refuses to write anything unless the
 * environment actually selected `cloudflare-router` AND the routed call actually succeeded, so
 * this record cannot be produced without the run having happened.
 *
 * It currently reads `harness` because **no Docket-owned Anthropic or Cloudflare credential exists
 * in this environment** — the routed path was exercised as far as Cloudflare's gateway, which
 * answered `401`. Update this record only by re-running that script with real keys; hand-editing it
 * would turn the gate back into a boolean someone flipped.
 */
export const CLOUDFLARE_ROUTER_VERIFICATION: ModelBackendVerification = {
  backendId: 'cloudflare-router',
  mode: 'harness',
  recordedAt: '2026-08-02',
  scenarios: ['chat', 'tool-call', 'scheduled-agent-action'],
  evidencePath: 'docs/engineering/evidence/athena-model-backend-verification.md',
};

/**
 * Whether the Lattice surface may be reached at all in this deployment.
 *
 * @remarks
 * Read by every Lattice route and by the settings surface. A gated deployment reports
 * `available: false` with a reason rather than 404-ing, so the UI can say something true instead
 * of looking broken.
 *
 * @returns True when the sequencing constraint is satisfied for this environment.
 */
export function latticeSequencingSatisfied(): boolean {
  if (CLOUDFLARE_ROUTER_VERIFICATION.mode === 'production-keys') return true;
  return env.APP_MODE !== 'production';
}
