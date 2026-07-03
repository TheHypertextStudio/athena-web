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

/**
 * Map the validated API `env` onto the boundary-relevant {@link BoundaryEnv} slice.
 *
 * @remarks
 * Exported so the integrations router can pass the same env slice to per-request
 * {@link selectAdapter} calls (the connector port is instantiated per-connection,
 * not from the cached singleton).
 */
export function toBoundaryEnv(): BoundaryEnv {
  return {
    APP_MODE: env.APP_MODE,
    // billing (Stripe)
    ...(env.STRIPE_SECRET_KEY ? { STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY } : {}),
    ...(env.STRIPE_WEBHOOK_SECRET ? { STRIPE_WEBHOOK_SECRET: env.STRIPE_WEBHOOK_SECRET } : {}),
    ...(env.STRIPE_PRICE_TEAM ? { STRIPE_PRICE_TEAM: env.STRIPE_PRICE_TEAM } : {}),
    ...(env.DOCKET_PRICE_LOOKUP_TEAM
      ? { DOCKET_PRICE_LOOKUP_TEAM: env.DOCKET_PRICE_LOOKUP_TEAM }
      : {}),
    ...(env.STRIPE_BILLING_PORTAL_CONFIG_ID
      ? { STRIPE_BILLING_PORTAL_CONFIG_ID: env.STRIPE_BILLING_PORTAL_CONFIG_ID }
      : {}),
    // agent runtime + daily-digest summarizer (Anthropic-backed Athena)
    ...(env.ANTHROPIC_API_KEY ? { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY } : {}),
    // observer (ambient-intelligence ingestion; app-level Linear webhook secret)
    ...(env.LINEAR_WEBHOOK_SECRET ? { LINEAR_WEBHOOK_SECRET: env.LINEAR_WEBHOOK_SECRET } : {}),
    ...(env.GITHUB_APP_WEBHOOK_SECRET
      ? { GITHUB_APP_WEBHOOK_SECRET: env.GITHUB_APP_WEBHOOK_SECRET }
      : {}),
    ...(env.SLACK_SIGNING_SECRET ? { SLACK_SIGNING_SECRET: env.SLACK_SIGNING_SECRET } : {}),
    ...(env.DISCORD_PUBLIC_KEY ? { DISCORD_PUBLIC_KEY: env.DISCORD_PUBLIC_KEY } : {}),
    // mailer (SMTP)
    ...(env.SMTP_HOST ? { SMTP_HOST: env.SMTP_HOST } : {}),
    ...(env.SMTP_PORT ? { SMTP_PORT: env.SMTP_PORT } : {}),
    ...(env.SMTP_SECURE ? { SMTP_SECURE: env.SMTP_SECURE } : {}),
    ...(env.SMTP_USER ? { SMTP_USER: env.SMTP_USER } : {}),
    ...(env.SMTP_PASS ? { SMTP_PASS: env.SMTP_PASS } : {}),
    ...(env.MAIL_FROM ? { MAIL_FROM: env.MAIL_FROM } : {}),
    // blob (Vercel Blob)
    ...(env.BLOB_READ_WRITE_TOKEN ? { BLOB_READ_WRITE_TOKEN: env.BLOB_READ_WRITE_TOKEN } : {}),
    ...(env.EXPORT_BUCKET_URL ? { EXPORT_BUCKET_URL: env.EXPORT_BUCKET_URL } : {}),
    // connector (per-provider API-base overrides; the OAuth token is per-connection)
    ...(env.GITHUB_API_BASE ? { GITHUB_API_BASE: env.GITHUB_API_BASE } : {}),
    ...(env.LINEAR_API_BASE ? { LINEAR_API_BASE: env.LINEAR_API_BASE } : {}),
    ...(env.GOOGLE_DRIVE_API_BASE ? { GOOGLE_DRIVE_API_BASE: env.GOOGLE_DRIVE_API_BASE } : {}),
    ...(env.GOOGLE_GMAIL_API_BASE ? { GOOGLE_GMAIL_API_BASE: env.GOOGLE_GMAIL_API_BASE } : {}),
    ...(env.MICROSOFT_GRAPH_API_BASE
      ? { MICROSOFT_GRAPH_API_BASE: env.MICROSOFT_GRAPH_API_BASE }
      : {}),
    ...(env.GOOGLE_CALENDAR_API_BASE
      ? { GOOGLE_CALENDAR_API_BASE: env.GOOGLE_CALENDAR_API_BASE }
      : {}),
    ...(env.GOOGLE_TASKS_API_BASE ? { GOOGLE_TASKS_API_BASE: env.GOOGLE_TASKS_API_BASE } : {}),
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
