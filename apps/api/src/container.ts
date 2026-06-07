/**
 * `@docket/api` — the boundary container, a lazy module singleton.
 *
 * @remarks
 * The API takes every external-I/O dependency (billing, agent runtime, connector,
 * mailer, blob) from one {@link BoundaryContainer} built by `@docket/boundaries`'
 * {@link buildContainer}. The container is resolved from the validated API `env`: the
 * resolver returns the real, env-driven adapter per port when that port's key is
 * present and real-shaped, otherwise the deterministic mock — and `APP_MODE ∈
 * {local,test}` forces the mocks (so placeholder Stripe keys + `APP_MODE=local`
 * yield the {@link InMemoryBillingGateway}).
 *
 * Construction is lazy and memoized via {@link getContainer} so importing this module
 * is side-effect-free; the first access builds (and caches) the container.
 */
import { buildContainer } from '@docket/boundaries';
import type { BoundaryContainer, BoundaryEnv } from '@docket/boundaries';

import { env } from './env';

/** The wired set of boundary adapters the API runs against (re-exported for handlers). */
export type { BoundaryContainer } from '@docket/boundaries';

/** Map the validated API `env` onto the boundary-relevant {@link BoundaryEnv} slice. */
function toBoundaryEnv(): BoundaryEnv {
  return {
    APP_MODE: env.APP_MODE,
    ...(env.STRIPE_SECRET_KEY ? { STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY } : {}),
    ...(env.STRIPE_PRICE_TEAM ? { STRIPE_PRICE_TEAM: env.STRIPE_PRICE_TEAM } : {}),
    ...(env.STRIPE_BILLING_PORTAL_CONFIG_ID
      ? { STRIPE_BILLING_PORTAL_CONFIG_ID: env.STRIPE_BILLING_PORTAL_CONFIG_ID }
      : {}),
    ...(env.ATHENA_AGENT_ENDPOINT ? { ATHENA_AGENT_ENDPOINT: env.ATHENA_AGENT_ENDPOINT } : {}),
    ...(env.ATHENA_AGENT_API_KEY ? { ATHENA_AGENT_API_KEY: env.ATHENA_AGENT_API_KEY } : {}),
    ...(env.BLOB_READ_WRITE_TOKEN ? { BLOB_READ_WRITE_TOKEN: env.BLOB_READ_WRITE_TOKEN } : {}),
    ...(env.EXPORT_BUCKET_URL ? { EXPORT_BUCKET_URL: env.EXPORT_BUCKET_URL } : {}),
  };
}

let cached: BoundaryContainer | undefined;

/**
 * Lazily build (once) and return the shared {@link BoundaryContainer}.
 *
 * @remarks
 * Memoized: the container is constructed on first call from the validated `env` and
 * cached for the process lifetime. Billing/agent/connector/mailer/blob handlers call
 * this rather than touching any provider SDK directly.
 *
 * @returns the process-wide boundary container.
 */
export function getContainer(): BoundaryContainer {
  return (cached ??= buildContainer(toBoundaryEnv()));
}
