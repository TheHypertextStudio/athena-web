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
import { SmtpMailer } from '../src/real/mailer';
import { RealBlob } from '../src/real/blob';

describe('selectAdapter', () => {
  it('forces mocks when APP_MODE is local even with real keys present', () => {
    const env: BoundaryEnv = {
      APP_MODE: 'local',
      STRIPE_SECRET_KEY: 'sk_live_realkey',
      ANTHROPIC_API_KEY: 'sk-ant-realkey',
      SMTP_HOST: 'smtp.example.com',
      MAIL_FROM: 'noreply@docket.dev',
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
      ANTHROPIC_API_KEY: 'your-key-here',
      SMTP_HOST: 'placeholder',
      MAIL_FROM: 'placeholder',
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
      ANTHROPIC_API_KEY: 'sk-ant-realkey',
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '587',
      MAIL_FROM: 'noreply@docket.dev',
      BLOB_READ_WRITE_TOKEN: 'real-blob-token',
      EXPORT_BUCKET_URL: 'https://blob.example.com',
    };
    expect(selectAdapter('billing', env)).toBeInstanceOf(RealStripeGateway);
    expect(selectAdapter('agentRuntime', env)).toBeInstanceOf(RealProviderRuntime);
    expect(selectAdapter('connector', env, { connectorToken: 'real-conn-token' })).toBeInstanceOf(
      RealConnector,
    );
    expect(selectAdapter('mailer', env)).toBeInstanceOf(SmtpMailer);
    expect(selectAdapter('blob', env)).toBeInstanceOf(RealBlob);
  });

  it('falls back to the mock agent runtime when ANTHROPIC_API_KEY is absent or a placeholder', () => {
    expect(selectAdapter('agentRuntime', { APP_MODE: 'production' })).toBeInstanceOf(
      MockAgentRuntime,
    );
    expect(
      selectAdapter('agentRuntime', {
        APP_MODE: 'production',
        ANTHROPIC_API_KEY: 'changeme',
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
      // A `price_…` id skips the lookup-key resolution so this exercises a single
      // Stripe SDK call (the embedded/hosted checkout create) through the injected http.
      priceKey: 'price_override',
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

  it('threads the per-provider API-base override from env into the real connector', async () => {
    const calls: string[] = [];
    const http = async (input: string): Promise<Response> => {
      calls.push(input);
      return new Response(JSON.stringify({ login: 'octocat' }), { status: 200 });
    };
    const connector = selectAdapter(
      'connector',
      { APP_MODE: 'production', GITHUB_API_BASE: 'https://ghe.example.com/api/v3' },
      { http, connectorProvider: 'github', connectorToken: 'real-conn-token' },
    );
    expect(connector).toBeInstanceOf(RealConnector);
    await connector.connect({ provider: 'github', referenceId: 'org_1' });
    expect(calls[0]).toContain('https://ghe.example.com/api/v3');
  });

  it('maps each non-github provider to its API-base env override', async () => {
    // Exercises the connectorApiBase mapping for linear/drive/gmail/calendar end-to-end:
    // the override base must appear in the first outbound request URL.
    const cases: { provider: 'linear' | 'drive' | 'gmail' | 'calendar'; env: BoundaryEnv }[] = [
      {
        provider: 'linear',
        env: { APP_MODE: 'production', LINEAR_API_BASE: 'https://linear.test' },
      },
      {
        provider: 'drive',
        env: { APP_MODE: 'production', GOOGLE_DRIVE_API_BASE: 'https://drive.test' },
      },
      {
        provider: 'gmail',
        env: { APP_MODE: 'production', GOOGLE_GMAIL_API_BASE: 'https://gmail.test' },
      },
      {
        provider: 'calendar',
        env: { APP_MODE: 'production', GOOGLE_CALENDAR_API_BASE: 'https://cal.test' },
      },
    ];
    for (const { provider, env } of cases) {
      const calls: string[] = [];
      const http = async (input: string): Promise<Response> => {
        calls.push(input);
        // A permissive payload that satisfies each provider client's identity lookup.
        return new Response(
          JSON.stringify({
            data: { viewer: { name: 'Viewer' } },
            user: { displayName: 'User', emailAddress: 'u@x' },
            emailAddress: 'u@x',
          }),
          { status: 200 },
        );
      };
      const connector = selectAdapter('connector', env, {
        http,
        connectorProvider: provider,
        connectorToken: 'real-conn-token',
      });
      await connector.connect({ provider, referenceId: 'org_1' });
      const overrideBase = Object.values(env).find(
        (v): v is string => typeof v === 'string' && v.includes('.test'),
      );
      expect(calls[0]).toContain(overrideBase);
    }
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
