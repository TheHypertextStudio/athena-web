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
import { CaptureMailer } from './mock/mailer';
import { LocalDiskBlob } from './mock/blob';
import type { AgentRuntime } from './ports/agent-runtime';
import type { BillingGateway } from './ports/billing';
import type { BlobStore } from './ports/blob';
import type { Connector, ConnectorProvider } from './ports/connector';
import type { Mailer } from './ports/mailer';
import { RealStripeGateway } from './real/billing';
import { RealProviderRuntime } from './real/agent-runtime';
import { RealConnector } from './real/connector';
import { RealMailer } from './real/mailer';
import { RealBlob } from './real/blob';
import type { HttpClient } from './real/http';

/** The boundary-relevant subset of validated env the resolver reads. */
export interface BoundaryEnv {
  /** Deploy mode; `local`/`test` force the mock adapters. */
  readonly APP_MODE?: AppMode;
  /** Stripe secret key — selects {@link RealStripeGateway} when real-shaped. */
  readonly STRIPE_SECRET_KEY?: string;
  /** Default Stripe price lookup key / price id. */
  readonly STRIPE_PRICE_TEAM?: string;
  /** Stripe billing portal configuration id. */
  readonly STRIPE_BILLING_PORTAL_CONFIG_ID?: string;
  /** Athena agent runtime endpoint — paired with {@link BoundaryEnv.ATHENA_AGENT_API_KEY}. */
  readonly ATHENA_AGENT_ENDPOINT?: string;
  /** Athena agent runtime API key — selects {@link RealProviderRuntime} when real-shaped. */
  readonly ATHENA_AGENT_API_KEY?: string;
  /** Mailer endpoint — paired with {@link BoundaryEnv.MAILER_API_KEY}. */
  readonly MAILER_ENDPOINT?: string;
  /** Mailer API key — selects {@link RealMailer} when real-shaped. */
  readonly MAILER_API_KEY?: string;
  /** Mailer from-address. */
  readonly MAILER_FROM?: string;
  /** Vercel Blob read/write token — selects {@link RealBlob} when real-shaped. */
  readonly BLOB_READ_WRITE_TOKEN?: string;
  /** Export bucket base URL (paired with the blob token). */
  readonly EXPORT_BUCKET_URL?: string;
}

/** The set of named ports {@link selectAdapter} can resolve. */
export type PortName = 'billing' | 'agentRuntime' | 'connector' | 'mailer' | 'blob';

/** Maps each {@link PortName} to its port interface (the resolved adapter type). */
export interface PortMap {
  /** The billing gateway port. */
  readonly billing: BillingGateway;
  /** The agent runtime port. */
  readonly agentRuntime: AgentRuntime;
  /** The connector port (bound to a single provider). */
  readonly connector: Connector;
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
}

/** Whether `APP_MODE` forces the mock adapters (`local`/`test`). */
function forcesMock(env: BoundaryEnv): boolean {
  return env.APP_MODE === 'local' || env.APP_MODE === 'test';
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
      const adapter: BillingGateway = useReal
        ? new RealStripeGateway(
            {
              secretKey: env.STRIPE_SECRET_KEY,
              ...(env.STRIPE_PRICE_TEAM ? { priceKey: env.STRIPE_PRICE_TEAM } : {}),
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
      const useReal =
        !mock && isRealValue(env.ATHENA_AGENT_API_KEY) && isRealValue(env.ATHENA_AGENT_ENDPOINT);
      const adapter: AgentRuntime = useReal
        ? new RealProviderRuntime(
            { endpoint: env.ATHENA_AGENT_ENDPOINT, apiKey: env.ATHENA_AGENT_API_KEY },
            options.http,
          )
        : new MockAgentRuntime();
      return adapter as PortMap[P];
    }
    case 'connector': {
      const provider = options.connectorProvider ?? 'github';
      const useReal = !mock && isRealValue(options.connectorToken);
      const adapter: Connector = useReal
        ? new RealConnector({ provider, accessToken: options.connectorToken }, options.http)
        : new MockConnector();
      return adapter as PortMap[P];
    }
    case 'mailer': {
      const useReal =
        !mock &&
        isRealValue(env.MAILER_API_KEY) &&
        isRealValue(env.MAILER_ENDPOINT) &&
        isRealValue(env.MAILER_FROM);
      const adapter: Mailer = useReal
        ? new RealMailer(
            { endpoint: env.MAILER_ENDPOINT, apiKey: env.MAILER_API_KEY, from: env.MAILER_FROM },
            options.http,
          )
        : new CaptureMailer();
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
    mailer: selectAdapter('mailer', env, options),
    blob: selectAdapter('blob', env, options),
  };
}
