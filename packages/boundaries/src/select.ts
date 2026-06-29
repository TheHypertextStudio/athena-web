/**
 * `@docket/boundaries` — the per-port adapter resolver + composition root.
 *
 * @remarks
 * {@link selectAdapter} returns the **real** adapter for a port when that port's
 * required env value is present and real-shaped (via `@docket/env`'s `isRealValue`),
 * otherwise the **mock** — and `APP_MODE ∈ {local, test}` forces mocks even when a
 * key is present (safety). There is never a third code path: flipping to prod is
 * purely supplying env values. {@link buildContainer} wires one selected adapter per
 * port (`boundaries.md`).
 */
import { isRealValue } from '@docket/env';
import type { AppMode } from '@docket/env';

import { InMemoryBillingGateway } from './mock/billing';
import { MockAgentRuntime } from './mock/agent-runtime';
import { MockConnector } from './mock/connector';
import { MockObserver } from './mock/observer';
import { MockSummarizer } from './mock/summarizer';
import { CaptureMailer } from './mock/mailer';
import { LocalDiskBlob } from './mock/blob';
import type { AgentRuntime } from './ports/agent-runtime';
import type { BillingGateway } from './ports/billing';
import type { BlobStore } from './ports/blob';
import type { Connector, ConnectorProvider } from './ports/connector';
import type { Mailer } from './ports/mailer';
import type { Observer } from './ports/observer';
import type { Summarizer } from './ports/summarizer';
import { RealStripeGateway } from './real/billing';
import { RealProviderRuntime } from './real/agent-runtime';
import { RealConnector } from './real/connector';
import { RealLinearObserver } from './real/observer-linear';
import { RealGitHubObserver } from './real/observer-github';
import { RealSummarizer } from './real/summarizer';
import { SmtpMailer, smtpConfigFromEnv } from './real/mailer';
import { RealBlob } from './real/blob';
import type { HttpClient } from './real/http';

/** The boundary-relevant subset of validated env the resolver reads. */
export interface BoundaryEnv {
  /** Deploy mode; `local`/`test` force the mock adapters. */
  readonly APP_MODE?: AppMode;
  /** Stripe secret key — selects {@link RealStripeGateway} when real-shaped. */
  readonly STRIPE_SECRET_KEY?: string;
  /** Stripe webhook signing secret (`whsec_...`) — enables {@link RealStripeGateway.verifyWebhook}. */
  readonly STRIPE_WEBHOOK_SECRET?: string;
  /** Default Stripe price lookup key / price id. */
  readonly STRIPE_PRICE_TEAM?: string;
  /** Stripe price `lookup_key` for the Team plan (alternative to {@link BoundaryEnv.STRIPE_PRICE_TEAM}). */
  readonly DOCKET_PRICE_LOOKUP_TEAM?: string;
  /** Stripe billing portal configuration id. */
  readonly STRIPE_BILLING_PORTAL_CONFIG_ID?: string;
  /**
   * Anthropic API key — selects {@link RealProviderRuntime} (the built-in Athena runtime)
   * and {@link RealSummarizer} (the daily-digest narrator) when real-shaped.
   */
  readonly ANTHROPIC_API_KEY?: string;
  /** App-level Linear webhook signing secret — selects {@link RealLinearObserver} when real-shaped. */
  readonly LINEAR_WEBHOOK_SECRET?: string;
  /** App-level GitHub App webhook signing secret — selects {@link RealGitHubObserver} when real-shaped. */
  readonly GITHUB_APP_WEBHOOK_SECRET?: string;
  /** SMTP relay host — selects {@link SmtpMailer} when present with {@link BoundaryEnv.MAIL_FROM}. */
  readonly SMTP_HOST?: string;
  /** SMTP port (string form; 587 STARTTLS, 465 implicit TLS, 1025 Mailpit). */
  readonly SMTP_PORT?: string;
  /** Whether SMTP uses implicit TLS from connect (`"true"`/`"false"`). */
  readonly SMTP_SECURE?: string;
  /** SMTP auth username (omit for unauthenticated relays such as Mailpit). */
  readonly SMTP_USER?: string;
  /** SMTP auth password (omit for unauthenticated relays such as Mailpit). */
  readonly SMTP_PASS?: string;
  /** From-address every transactional email is sent as; paired with {@link BoundaryEnv.SMTP_HOST}. */
  readonly MAIL_FROM?: string;
  /** Vercel Blob read/write token — selects {@link RealBlob} when real-shaped. */
  readonly BLOB_READ_WRITE_TOKEN?: string;
  /** Export bucket base URL (paired with the blob token). */
  readonly EXPORT_BUCKET_URL?: string;
  /** GitHub REST API base override (self-hosted/Enterprise); absent ⇒ public base. */
  readonly GITHUB_API_BASE?: string;
  /** Linear GraphQL API base override; absent ⇒ public base. */
  readonly LINEAR_API_BASE?: string;
  /** Google Drive REST API base override; absent ⇒ public base. */
  readonly GOOGLE_DRIVE_API_BASE?: string;
  /** Gmail REST API base override; absent ⇒ public base. */
  readonly GOOGLE_GMAIL_API_BASE?: string;
  /** Google Calendar REST API base override; absent ⇒ public base. */
  readonly GOOGLE_CALENDAR_API_BASE?: string;
  /** Google Tasks REST API base override; absent ⇒ public base. */
  readonly GOOGLE_TASKS_API_BASE?: string;
}

/** The set of named ports {@link selectAdapter} can resolve. */
export type PortName =
  | 'billing'
  | 'agentRuntime'
  | 'connector'
  | 'observer'
  | 'summarizer'
  | 'mailer'
  | 'blob';

/** Maps each {@link PortName} to its port interface (the resolved adapter type). */
export interface PortMap {
  /** The billing gateway port. */
  readonly billing: BillingGateway;
  /** The agent runtime port. */
  readonly agentRuntime: AgentRuntime;
  /** The connector port (bound to a single provider). */
  readonly connector: Connector;
  /** The observer port (ambient-intelligence ingestion, bound to a single provider). */
  readonly observer: Observer;
  /** The summarizer port (daily-digest narration). */
  readonly summarizer: Summarizer;
  /** The mailer port. */
  readonly mailer: Mailer;
  /** The blob store port. */
  readonly blob: BlobStore;
}

/** Optional injectables for the resolver (HTTP transport, fixed-blob root, provider). */
export interface SelectOptions {
  /** HTTP transport passed to whichever real adapter is selected. */
  readonly http?: HttpClient;
  /** Root directory for the mock {@link LocalDiskBlob}. */
  readonly blobRoot?: string;
  /** Provider to bind the connector port to (defaults to `github`). */
  readonly connectorProvider?: ConnectorProvider;
  /** OAuth token for the real connector (from the resolved credential, not env). */
  readonly connectorToken?: string;
  /** Provider to bind the observer port to (defaults to `linear`). */
  readonly observerProvider?: ConnectorProvider;
}

/**
 * The app-level webhook signing secret for an observer provider, if configured.
 *
 * @remarks
 * Only Linear has a real observer in Phase 0 (its OAuth app signs every webhook with one
 * app-level secret); other providers have no real observer yet and resolve to the mock.
 *
 * @param provider - The observer provider being bound.
 * @param env - The boundary-relevant env slice.
 * @returns the signing secret, or `undefined` when none is configured for the provider.
 */
function observerSecret(provider: ConnectorProvider, env: BoundaryEnv): string | undefined {
  switch (provider) {
    case 'linear':
      return env.LINEAR_WEBHOOK_SECRET;
    case 'github':
      return env.GITHUB_APP_WEBHOOK_SECRET;
    default:
      return undefined;
  }
}

/** Whether `APP_MODE` forces the mock adapters (`local`/`test`). */
function forcesMock(env: BoundaryEnv): boolean {
  return env.APP_MODE === 'local' || env.APP_MODE === 'test';
}

/**
 * The optional per-provider API-base override from env, if any.
 *
 * @remarks
 * Each value is an optional self-hosted/Enterprise base (e.g. GitHub Enterprise); absent
 * ⇒ the provider's public API base is used by {@link RealConnector}.
 *
 * @param provider - The connector provider being bound.
 * @param env - The boundary-relevant env slice.
 * @returns the override base URL, or `undefined` when none is configured.
 */
function connectorApiBase(provider: ConnectorProvider, env: BoundaryEnv): string | undefined {
  switch (provider) {
    case 'github':
      return env.GITHUB_API_BASE;
    case 'linear':
      return env.LINEAR_API_BASE;
    case 'drive':
      return env.GOOGLE_DRIVE_API_BASE;
    case 'gmail':
      return env.GOOGLE_GMAIL_API_BASE;
    case 'calendar':
      return env.GOOGLE_CALENDAR_API_BASE;
    case 'gtasks':
      return env.GOOGLE_TASKS_API_BASE;
    default:
      /* v8 ignore next -- exhaustiveness guard: `provider` is `never` here. */
      return undefined;
  }
}

/**
 * Resolve a single port to its real or mock adapter from the validated env.
 *
 * @remarks
 * Returns the mock whenever `APP_MODE ∈ {local,test}` or the port's required env
 * value is absent/placeholder; otherwise returns the real, env-driven adapter.
 *
 * @typeParam P - The port name being resolved.
 * @param port - Which port to resolve.
 * @param env - The boundary-relevant env slice.
 * @param options - Optional HTTP transport / blob root / connector binding.
 * @returns the selected adapter implementing the named port.
 */
export function selectAdapter<P extends PortName>(
  port: P,
  env: BoundaryEnv,
  options: SelectOptions = {},
): PortMap[P] {
  const mock = forcesMock(env);
  switch (port) {
    case 'billing': {
      const useReal = !mock && isRealValue(env.STRIPE_SECRET_KEY);
      // Prefer an explicit price id; otherwise use the lookup key (resolved to a price
      // id by the gateway on demand).
      const priceKey = env.STRIPE_PRICE_TEAM ?? env.DOCKET_PRICE_LOOKUP_TEAM;
      const adapter: BillingGateway = useReal
        ? new RealStripeGateway(
            {
              secretKey: env.STRIPE_SECRET_KEY,
              ...(priceKey ? { priceKey } : {}),
              ...(env.STRIPE_WEBHOOK_SECRET ? { webhookSecret: env.STRIPE_WEBHOOK_SECRET } : {}),
              ...(env.STRIPE_BILLING_PORTAL_CONFIG_ID
                ? { portalConfigId: env.STRIPE_BILLING_PORTAL_CONFIG_ID }
                : {}),
            },
            options.http,
          )
        : new InMemoryBillingGateway();
      return adapter as PortMap[P];
    }
    case 'agentRuntime': {
      // The built-in Athena runtime is the Anthropic Messages API; the SDK manages its
      // own transport, so `options.http` is intentionally NOT threaded here.
      const useReal = !mock && isRealValue(env.ANTHROPIC_API_KEY);
      const adapter: AgentRuntime = useReal
        ? new RealProviderRuntime({ apiKey: env.ANTHROPIC_API_KEY })
        : new MockAgentRuntime();
      return adapter as PortMap[P];
    }
    case 'connector': {
      const provider = options.connectorProvider ?? 'github';
      const useReal = !mock && isRealValue(options.connectorToken);
      const apiBase = connectorApiBase(provider, env);
      const adapter: Connector = useReal
        ? new RealConnector(
            {
              provider,
              accessToken: options.connectorToken,
              ...(apiBase ? { apiBase } : {}),
            },
            options.http,
          )
        : new MockConnector({ provider });
      return adapter as PortMap[P];
    }
    case 'observer': {
      // Bound to one provider (like the connector). Linear and GitHub have real observers, each
      // verifying with its own app-level webhook secret; anything else uses the mock.
      const provider = options.observerProvider ?? 'linear';
      const secret = observerSecret(provider, env);
      const useReal = !mock && isRealValue(secret);
      let adapter: Observer;
      if (useReal && provider === 'linear') {
        adapter = new RealLinearObserver({ signingSecret: secret });
      } else if (useReal && provider === 'github') {
        adapter = new RealGitHubObserver({ signingSecret: secret });
      } else {
        adapter = new MockObserver({ provider });
      }
      return adapter as PortMap[P];
    }
    case 'summarizer': {
      // The digest narrator is the Anthropic Messages API (same key as the agent runtime);
      // the SDK manages its own transport, so `options.http` is intentionally NOT threaded.
      const useReal = !mock && isRealValue(env.ANTHROPIC_API_KEY);
      const adapter: Summarizer = useReal
        ? new RealSummarizer({ apiKey: env.ANTHROPIC_API_KEY })
        : new MockSummarizer();
      return adapter as PortMap[P];
    }
    case 'mailer': {
      // Transactional email goes over SMTP (Mailpit locally, a real relay in prod). The
      // env is real-shaped only when both the relay host and the from-address are set;
      // `smtpConfigFromEnv` then parses/validates the rest (and returns null if not
      // configured), so a missing/placeholder relay falls back to the capture mock.
      const smtpReal = !mock && isRealValue(env.SMTP_HOST) && isRealValue(env.MAIL_FROM);
      const smtpConfig = smtpReal ? smtpConfigFromEnv(env) : null;
      const adapter: Mailer = smtpConfig ? new SmtpMailer(smtpConfig) : new CaptureMailer();
      return adapter as PortMap[P];
    }
    case 'blob': {
      const useReal =
        !mock && isRealValue(env.BLOB_READ_WRITE_TOKEN) && isRealValue(env.EXPORT_BUCKET_URL);
      const adapter: BlobStore = useReal
        ? new RealBlob(
            { baseUrl: env.EXPORT_BUCKET_URL, token: env.BLOB_READ_WRITE_TOKEN },
            options.http,
          )
        : new LocalDiskBlob(options.blobRoot ? { root: options.blobRoot } : {});
      return adapter as PortMap[P];
    }
    default: {
      // Exhaustiveness guard: `port` is `never` here.
      throw new Error(`Unknown port: ${String(port)}`);
    }
  }
}

/**
 * The wired set of boundary adapters Docket runs against — one per port.
 *
 * @remarks
 * Produced by {@link buildContainer}; the API, MCP server, crons, and Next server
 * actions take their dependencies from here.
 */
export interface BoundaryContainer {
  /** The selected billing gateway. */
  readonly billing: BillingGateway;
  /** The selected agent runtime. */
  readonly agentRuntime: AgentRuntime;
  /** The selected connector (bound to {@link SelectOptions.connectorProvider}). */
  readonly connector: Connector;
  /** The selected observer (bound to {@link SelectOptions.observerProvider}). */
  readonly observer: Observer;
  /** The selected daily-digest summarizer. */
  readonly summarizer: Summarizer;
  /** The selected mailer. */
  readonly mailer: Mailer;
  /** The selected blob store. */
  readonly blob: BlobStore;
}

/**
 * The composition root: resolve every port from `env` into one container.
 *
 * @param env - The boundary-relevant env slice.
 * @param options - Optional HTTP transport / blob root / connector binding.
 * @returns a {@link BoundaryContainer} with one selected adapter per port.
 */
export function buildContainer(env: BoundaryEnv, options: SelectOptions = {}): BoundaryContainer {
  return {
    billing: selectAdapter('billing', env, options),
    agentRuntime: selectAdapter('agentRuntime', env, options),
    connector: selectAdapter('connector', env, options),
    observer: selectAdapter('observer', env, options),
    summarizer: selectAdapter('summarizer', env, options),
    mailer: selectAdapter('mailer', env, options),
    blob: selectAdapter('blob', env, options),
  };
}
