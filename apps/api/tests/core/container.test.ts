/**
 * `@docket/api` — the DI container's real/mock builder seams.
 *
 * @remarks
 * Every builder here takes an injectable `runtimeEnv`, which is the whole point: local/test mode
 * always gets a mock with zero external accounts, and production mode refuses to construct a real
 * adapter without its required credential rather than silently degrading. These tests exercise
 * both sides of that seam for every builder, not just the mock side the rest of the suite already
 * exercises implicitly through `getContainer()`.
 */
import { describe, expect, it } from 'vitest';

import { RealStripeGateway } from '@docket/billing';
import {
  CapturePushSender,
  CaptureSmsSender,
  MockConnector,
  MockLinearAgent,
  MockObserver,
  RealConnector,
  RealGitHubObserver,
  RealLinearAgentPort,
  RealLinearObserver,
  RealPushSender,
  RealSmsSender,
} from '@docket/integrations';

import {
  anthropicConfigFromEnv,
  buildAppContainer,
  buildConnector,
  buildLinearAgentClient,
  buildObserver,
  resolveDocketProPriceKey,
  toModelBackendEnv,
  type AppRuntimeEnv,
} from '../../src/container';
import { MockRealtimeProvider, OpenAiRealtimeProvider } from '../../src/routes/voice-provider';

const LOCAL: AppRuntimeEnv = { APP_MODE: 'local' };
const PROD_BASE: AppRuntimeEnv = { APP_MODE: 'production' };

describe('resolveDocketProPriceKey', () => {
  it('prefers the Docket Pro configuration name', () => {
    expect(
      resolveDocketProPriceKey({
        STRIPE_PRICE_DOCKET_PRO: 'price_pro',
        STRIPE_PRICE_TEAM: 'price_legacy',
      }),
    ).toBe('price_pro');
  });

  it('accepts the former Docket Team configuration name for one release', () => {
    expect(resolveDocketProPriceKey({ STRIPE_PRICE_TEAM: 'price_legacy' })).toBe('price_legacy');
  });
});

describe('toModelBackendEnv', () => {
  it('carries every configured field through', () => {
    expect(
      toModelBackendEnv({
        APP_MODE: 'production',
        ANTHROPIC_API_KEY: 'sk-ant',
        CLOUDFLARE_AI_GATEWAY_BASE_URL: 'https://gw.example',
        CLOUDFLARE_AI_GATEWAY_TOKEN: 'tok',
      }),
    ).toEqual({
      APP_MODE: 'production',
      ANTHROPIC_API_KEY: 'sk-ant',
      CLOUDFLARE_AI_GATEWAY_BASE_URL: 'https://gw.example',
      CLOUDFLARE_AI_GATEWAY_TOKEN: 'tok',
    });
  });

  it('omits every field that is absent', () => {
    expect(toModelBackendEnv({})).toEqual({});
  });
});

describe('anthropicConfigFromEnv', () => {
  it('uses only the direct API key when no Gateway settings are configured', () => {
    expect(anthropicConfigFromEnv({ ANTHROPIC_API_KEY: 'sk-ant-direct' })).toEqual({
      apiKey: 'sk-ant-direct',
    });
  });

  it('refuses to build without an API key', () => {
    expect(() => anthropicConfigFromEnv({})).toThrow(
      'Missing required production config: ANTHROPIC_API_KEY',
    );
  });
});

describe('buildConnector', () => {
  it('returns a mock connector in local/test mode, even with no token', () => {
    expect(buildConnector('github', undefined, LOCAL)).toBeInstanceOf(MockConnector);
  });

  it.each(['github', 'linear', 'gmail', 'calendar', 'gtasks'] as const)(
    'builds a real %s connector in production, using that provider’s configured API base',
    (provider) => {
      const apiBaseKey = {
        github: 'GITHUB_API_BASE',
        linear: 'LINEAR_API_BASE',
        gmail: 'GOOGLE_GMAIL_API_BASE',
        calendar: 'GOOGLE_CALENDAR_API_BASE',
        gtasks: 'GOOGLE_TASKS_API_BASE',
      } as const;
      const connector = buildConnector(provider, 'tok', {
        ...PROD_BASE,
        [apiBaseKey[provider]]: `https://${provider}.example`,
      });
      expect(connector).toBeInstanceOf(RealConnector);
    },
  );

  it('refuses to build a production connector without an access token', () => {
    expect(() => buildConnector('github', undefined, PROD_BASE)).toThrow(
      'Missing required production config: GITHUB_ACCESS_TOKEN',
    );
  });

  it('builds a real connector with no api base override for a provider outside the api-base map', () => {
    // `notion` is a real ConnectorProvider with no entry in `connectorApiBase`'s switch, so it
    // still builds — just without an `apiBase` override (the connector uses its own default).
    expect(buildConnector('notion', 'tok', PROD_BASE)).toBeInstanceOf(RealConnector);
  });
});

describe('buildObserver', () => {
  it('returns a mock observer in local/test mode', () => {
    expect(buildObserver('linear', LOCAL)).toBeInstanceOf(MockObserver);
  });

  it('builds a real Linear observer in production with its webhook secret', () => {
    const observer = buildObserver('linear', { ...PROD_BASE, LINEAR_WEBHOOK_SECRET: 'sec' });
    expect(observer).toBeInstanceOf(RealLinearObserver);
  });

  it('refuses a production Linear observer without a webhook secret', () => {
    expect(() => buildObserver('linear', PROD_BASE)).toThrow(
      'Missing required production config: LINEAR_WEBHOOK_SECRET',
    );
  });

  it('builds a real GitHub observer in production with its webhook secret', () => {
    const observer = buildObserver('github', {
      ...PROD_BASE,
      GITHUB_APP_WEBHOOK_SECRET: 'sec',
    });
    expect(observer).toBeInstanceOf(RealGitHubObserver);
  });

  it('refuses a production GitHub observer without a webhook secret', () => {
    expect(() => buildObserver('github', PROD_BASE)).toThrow(
      'Missing required production config: GITHUB_APP_WEBHOOK_SECRET',
    );
  });

  it('refuses an unsupported observer provider in production', () => {
    expect(() => buildObserver('discord', PROD_BASE)).toThrow(
      'No active observer implementation for legacy provider: discord',
    );
  });
});

describe('buildLinearAgentClient', () => {
  it('returns a mock in local/test mode, even with no access token', () => {
    expect(buildLinearAgentClient(undefined, LOCAL)).toBeInstanceOf(MockLinearAgent);
  });

  it('builds the real port in production with an access token', () => {
    expect(buildLinearAgentClient('tok', PROD_BASE)).toBeInstanceOf(RealLinearAgentPort);
  });

  it('refuses in production without an access token', () => {
    expect(() => buildLinearAgentClient(undefined, PROD_BASE)).toThrow(
      'Missing required production config: LINEAR_AGENT_ACCESS_TOKEN',
    );
  });
});

describe('buildAppContainer', () => {
  it('builds every mock service in local mode with no credentials configured', () => {
    const container = buildAppContainer(LOCAL);
    expect(container.sms).toBeInstanceOf(CaptureSmsSender);
    expect(container.push).toBeInstanceOf(CapturePushSender);
    expect(container.voice).toBeInstanceOf(MockRealtimeProvider);
    // Touch every lazy getter once so its accessor line is exercised.
    expect(container.billing).toBeDefined();
    expect(container.agentRuntime).toBeDefined();
    expect(container.agentTurn).toBeDefined();
    expect(container.summarizer).toBeDefined();
    expect(container.taskSynthesizer).toBeDefined();
    expect(container.mailer).toBeDefined();
    expect(container.inboundMail).toBeDefined();
    expect(container.mcpConnector).toBeDefined();
    expect(container.blob).toBeDefined();
  });

  it('uses the real Stripe sandbox locally after managed billing setup is enabled', () => {
    const container = buildAppContainer({
      APP_MODE: 'local',
      BILLING_ENABLED: true,
      STRIPE_SECRET_KEY: 'sk_test_x',
      STRIPE_PRICE_DOCKET_PRO: 'price_test_x',
      STRIPE_WEBHOOK_SECRET: 'whsec_test_x',
      STRIPE_BILLING_PORTAL_CONFIG_ID: 'bpc_test_x',
    });

    expect(container.billing).toBeInstanceOf(RealStripeGateway);
  });

  it('builds every real service in production mode with a fully configured environment', () => {
    const container = buildAppContainer({
      APP_MODE: 'production',
      STRIPE_SECRET_KEY: 'sk_live_x',
      STRIPE_PRICE_DOCKET_PRO: 'price_x',
      STRIPE_WEBHOOK_SECRET: 'whsec_x',
      STRIPE_BILLING_PORTAL_CONFIG_ID: 'bpc_x',
      ANTHROPIC_API_KEY: 'sk-ant-x',
      RESEND_API_KEY: 'resend-key',
      RESEND_INBOUND_WEBHOOK_SECRET: 'resend-inbound-secret',
      RESEND_RECEIVING_API_BASE: 'https://resend.example/api',
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '587',
      SMTP_SECURE: 'true',
      SMTP_USER: 'smtp-user',
      SMTP_PASS: 'smtp-pass',
      MAIL_FROM: 'athena@docket.example',
      SMS_ENDPOINT: 'https://sms.example/send',
      SMS_API_KEY: 'sms-key',
      SMS_FROM: '+15550001111',
      PUSH_ENDPOINT: 'https://push.example/send',
      PUSH_API_KEY: 'push-key',
      PUSH_APP_ID: 'push-app',
      BLOB_READ_WRITE_TOKEN: 'blob-token',
      EXPORT_BUCKET_URL: 'https://blob.example/exports',
      OPENAI_API_KEY: 'sk-openai-x',
    });
    expect(container.sms).toBeInstanceOf(RealSmsSender);
    expect(container.push).toBeInstanceOf(RealPushSender);
    expect(container.voice).toBeInstanceOf(OpenAiRealtimeProvider);
    expect(container.mailer).toBeDefined();
    expect(container.inboundMail).toBeDefined();
    expect(container.mcpConnector).toBeDefined();
    expect(container.blob).toBeDefined();
    expect(container.agentRuntime).toBeDefined();
    expect(container.summarizer).toBeDefined();
    expect(container.taskSynthesizer).toBeDefined();
  });

  it('builds every real service in production mode with the price/gateway/bucket fields omitted', () => {
    // Covers the "no priceKey", "no webhookSecret/portalConfigId", and "no EXPORT_BUCKET_URL"
    // sides of buildAppContainer's optional-field ternaries.
    const container = buildAppContainer({
      APP_MODE: 'production',
      STRIPE_SECRET_KEY: 'sk_live_x',
      ANTHROPIC_API_KEY: 'sk-ant-x',
      RESEND_API_KEY: 'resend-key',
      RESEND_INBOUND_WEBHOOK_SECRET: 'resend-inbound-secret',
      MAIL_FROM: 'athena@docket.example',
      SMS_ENDPOINT: 'https://sms.example/send',
      SMS_API_KEY: 'sms-key',
      SMS_FROM: '+15550001111',
      PUSH_ENDPOINT: 'https://push.example/send',
      PUSH_API_KEY: 'push-key',
      PUSH_APP_ID: 'push-app',
      BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_teststore123_abcdef',
    });
    expect(container.billing).toBeDefined();
    expect(container.blob).toBeDefined();
    expect(container.mailer).toBeDefined();
    expect(container.inboundMail).toBeDefined();
  });

  it('refuses production billing without a Stripe secret key', () => {
    const container = buildAppContainer(PROD_BASE);
    expect(() => container.billing).toThrow(
      'Missing required production config: STRIPE_SECRET_KEY',
    );
  });

  it('refuses production SMS without SMS config', () => {
    const container = buildAppContainer(PROD_BASE);
    expect(() => container.sms).toThrow(
      'Missing required production SMS config: SMS_ENDPOINT, SMS_API_KEY, SMS_FROM',
    );
  });

  it('refuses production push without push config', () => {
    const container = buildAppContainer(PROD_BASE);
    expect(() => container.push).toThrow(
      'Missing required production push config: PUSH_ENDPOINT, PUSH_API_KEY, PUSH_APP_ID',
    );
  });

  it('refuses production blob storage without a token', () => {
    const container = buildAppContainer(PROD_BASE);
    expect(() => container.blob).toThrow(
      'Missing required production config: BLOB_READ_WRITE_TOKEN',
    );
  });
});
