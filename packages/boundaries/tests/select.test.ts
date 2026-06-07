import { describe, expect, it } from 'vitest';

import { buildContainer, selectAdapter, type BoundaryEnv } from '../src/select';
import { InMemoryBillingGateway } from '../src/mock/billing';
import { MockAgentRuntime } from '../src/mock/agent-runtime';
import { MockConnector } from '../src/mock/connector';
import { CaptureMailer } from '../src/mock/mailer';
import { LocalDiskBlob } from '../src/mock/blob';
import { RealStripeGateway } from '../src/real/billing';
import { RealProviderRuntime } from '../src/real/agent-runtime';
import { RealConnector } from '../src/real/connector';
import { RealMailer } from '../src/real/mailer';
import { RealBlob } from '../src/real/blob';

describe('selectAdapter', () => {
  it('forces mocks when APP_MODE is local even with real keys present', () => {
    const env: BoundaryEnv = {
      APP_MODE: 'local',
      STRIPE_SECRET_KEY: 'sk_live_realkey',
      ATHENA_AGENT_ENDPOINT: 'https://agent.example.com',
      ATHENA_AGENT_API_KEY: 'real-agent-key',
      MAILER_ENDPOINT: 'https://mail.example.com',
      MAILER_API_KEY: 'real-mail-key',
      MAILER_FROM: 'noreply@docket.dev',
      BLOB_READ_WRITE_TOKEN: 'real-blob-token',
      EXPORT_BUCKET_URL: 'https://blob.example.com',
    };
    expect(selectAdapter('billing', env)).toBeInstanceOf(InMemoryBillingGateway);
    expect(selectAdapter('agentRuntime', env)).toBeInstanceOf(MockAgentRuntime);
    expect(selectAdapter('connector', env, { connectorToken: 'real-token' })).toBeInstanceOf(
      MockConnector,
    );
    expect(selectAdapter('mailer', env)).toBeInstanceOf(CaptureMailer);
    expect(selectAdapter('blob', env)).toBeInstanceOf(LocalDiskBlob);
  });

  it('forces mocks when APP_MODE is test', () => {
    const env: BoundaryEnv = { APP_MODE: 'test', STRIPE_SECRET_KEY: 'sk_live_realkey' };
    expect(selectAdapter('billing', env)).toBeInstanceOf(InMemoryBillingGateway);
  });

  it('selects mocks in production when env values are absent', () => {
    const env: BoundaryEnv = { APP_MODE: 'production' };
    expect(selectAdapter('billing', env)).toBeInstanceOf(InMemoryBillingGateway);
    expect(selectAdapter('agentRuntime', env)).toBeInstanceOf(MockAgentRuntime);
    expect(selectAdapter('connector', env)).toBeInstanceOf(MockConnector);
    expect(selectAdapter('mailer', env)).toBeInstanceOf(CaptureMailer);
    expect(selectAdapter('blob', env)).toBeInstanceOf(LocalDiskBlob);
  });

  it('selects mocks in production when env values are placeholders', () => {
    const env: BoundaryEnv = {
      APP_MODE: 'production',
      STRIPE_SECRET_KEY: 'changeme',
      ATHENA_AGENT_API_KEY: 'your-key-here',
      ATHENA_AGENT_ENDPOINT: 'https://agent.example.com',
      MAILER_API_KEY: 'placeholder',
      BLOB_READ_WRITE_TOKEN: 'mock',
    };
    expect(selectAdapter('billing', env)).toBeInstanceOf(InMemoryBillingGateway);
    expect(selectAdapter('agentRuntime', env)).toBeInstanceOf(MockAgentRuntime);
    expect(selectAdapter('mailer', env)).toBeInstanceOf(CaptureMailer);
    expect(selectAdapter('blob', env)).toBeInstanceOf(LocalDiskBlob);
  });

  it('selects real adapters in production when env values are present and real-shaped', () => {
    const env: BoundaryEnv = {
      APP_MODE: 'production',
      STRIPE_SECRET_KEY: 'sk_live_realkey',
      STRIPE_PRICE_TEAM: 'price_123',
      ATHENA_AGENT_ENDPOINT: 'https://agent.example.com',
      ATHENA_AGENT_API_KEY: 'real-agent-key',
      MAILER_ENDPOINT: 'https://mail.example.com',
      MAILER_API_KEY: 'real-mail-key',
      MAILER_FROM: 'noreply@docket.dev',
      BLOB_READ_WRITE_TOKEN: 'real-blob-token',
      EXPORT_BUCKET_URL: 'https://blob.example.com',
    };
    expect(selectAdapter('billing', env)).toBeInstanceOf(RealStripeGateway);
    expect(selectAdapter('agentRuntime', env)).toBeInstanceOf(RealProviderRuntime);
    expect(selectAdapter('connector', env, { connectorToken: 'real-conn-token' })).toBeInstanceOf(
      RealConnector,
    );
    expect(selectAdapter('mailer', env)).toBeInstanceOf(RealMailer);
    expect(selectAdapter('blob', env)).toBeInstanceOf(RealBlob);
  });

  it('falls back to the mock when a paired env value is missing', () => {
    // endpoint present but key missing -> mock; key present but endpoint missing -> mock
    expect(
      selectAdapter('agentRuntime', {
        APP_MODE: 'production',
        ATHENA_AGENT_ENDPOINT: 'https://agent.example.com',
      }),
    ).toBeInstanceOf(MockAgentRuntime);
    expect(
      selectAdapter('agentRuntime', {
        APP_MODE: 'production',
        ATHENA_AGENT_API_KEY: 'real-agent-key',
      }),
    ).toBeInstanceOf(MockAgentRuntime);
  });

  it('treats an undefined APP_MODE like production for selection', () => {
    expect(selectAdapter('billing', { STRIPE_SECRET_KEY: 'sk_live_realkey' })).toBeInstanceOf(
      RealStripeGateway,
    );
    expect(selectAdapter('billing', {})).toBeInstanceOf(InMemoryBillingGateway);
  });

  it('passes the injected HttpClient through to the real billing adapter', async () => {
    const calls: string[] = [];
    const http = async (input: string): Promise<Response> => {
      calls.push(input);
      return new Response(JSON.stringify({ id: 'cs_1', url: 'https://pay' }), { status: 200 });
    };
    const gw = selectAdapter(
      'billing',
      {
        APP_MODE: 'production',
        STRIPE_SECRET_KEY: 'sk_live_realkey',
        STRIPE_PRICE_TEAM: 'price_1',
        STRIPE_BILLING_PORTAL_CONFIG_ID: 'bpc_1',
      },
      { http },
    );
    await gw.createCheckoutSession({
      referenceId: 'org_1',
      priceKey: 'p',
      successUrl: 's',
      cancelUrl: 'c',
    });
    expect(calls[0]).toContain('https://api.stripe.com');
  });

  it('binds the real connector to the requested provider with the injected token', async () => {
    const calls: string[] = [];
    const http = async (input: string): Promise<Response> => {
      calls.push(input);
      return new Response(JSON.stringify({ login: 'octocat' }), { status: 200 });
    };
    const connector = selectAdapter(
      'connector',
      { APP_MODE: 'production' },
      { http, connectorProvider: 'github', connectorToken: 'real-conn-token' },
    );
    expect(connector).toBeInstanceOf(RealConnector);
    await connector.connect({ provider: 'github', referenceId: 'org_1' });
    expect(calls[0]).toContain('https://api.github.com');
  });

  it('uses the provided blob root for the mock blob store', () => {
    const blob = selectAdapter('blob', { APP_MODE: 'test' }, { blobRoot: '/tmp/docket-blob-root' });
    expect(blob).toBeInstanceOf(LocalDiskBlob);
    expect(blob.url('a.txt')).toContain('docket-blob-root');
  });

  it('throws on an unknown port (exhaustiveness guard)', () => {
    expect(() =>
      // Cast through `unknown` to reach the defensive default arm.
      selectAdapter('nope' as unknown as 'billing', { APP_MODE: 'test' }),
    ).toThrow(/Unknown port: nope/);
  });
});

describe('buildContainer', () => {
  it('wires every port and uses mocks under APP_MODE=test', () => {
    const container = buildContainer({ APP_MODE: 'test' });
    expect(container.billing).toBeInstanceOf(InMemoryBillingGateway);
    expect(container.agentRuntime).toBeInstanceOf(MockAgentRuntime);
    expect(container.connector).toBeInstanceOf(MockConnector);
    expect(container.mailer).toBeInstanceOf(CaptureMailer);
    expect(container.blob).toBeInstanceOf(LocalDiskBlob);
  });

  it('binds the connector to the requested provider', async () => {
    const container = buildContainer({ APP_MODE: 'test' }, { connectorProvider: 'linear' });
    const conn = await container.connector.connect({ provider: 'linear', referenceId: 'org_1' });
    expect(conn.provider).toBe('linear');
    expect(conn.status).toBe('connected');
  });
});
