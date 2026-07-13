import {
  MockAgentRuntime,
  MockAgentTurnRuntime,
  MockSummarizer,
  MockTaskSynthesizer,
  RealAgentTurnRuntime,
  RealProviderRuntime,
  RealSummarizer,
  RealTaskSynthesizer,
} from '@docket/agent-runtime';
import type {
  AgentRuntime,
  AgentTurnRuntime,
  Summarizer,
  TaskSynthesizer,
} from '@docket/agent-runtime';
import { InMemoryBillingGateway, RealStripeGateway } from '@docket/billing';
import type { BillingGateway } from '@docket/billing';
import { LocalDiskBlob, RealBlob } from '@docket/blob-store';
import type { BlobStore } from '@docket/blob-store';
import { isRealValue } from '@docket/env';
import {
  CapturePushSender,
  CaptureSmsSender,
  MockMcpConnector,
  MockConnector,
  MockObserver,
  RealMcpConnector,
  RealPushSender,
  RealConnector,
  RealGitHubObserver,
  RealLinearObserver,
  RealSmsSender,
  pushConfigFromEnv,
  smsConfigFromEnv,
} from '@docket/integrations';
import type {
  Connector,
  ConnectorProvider,
  McpConnector,
  Observer,
  ObserverProvider,
  PushSender,
  SmsSender,
} from '@docket/integrations';
import { buildMailerFromEnv } from '@docket/mail';
import type { Mailer } from '@docket/mail';

import { env } from './env';

/** Runtime configuration values used to choose local mocks or production services. */
export interface AppRuntimeEnv {
  readonly APP_MODE?: 'local' | 'test' | 'production';
  readonly STRIPE_SECRET_KEY?: string;
  readonly STRIPE_WEBHOOK_SECRET?: string;
  readonly STRIPE_PRICE_TEAM?: string;
  readonly DOCKET_PRICE_LOOKUP_TEAM?: string;
  readonly STRIPE_BILLING_PORTAL_CONFIG_ID?: string;
  readonly ANTHROPIC_API_KEY?: string;
  readonly LINEAR_WEBHOOK_SECRET?: string;
  readonly GITHUB_APP_WEBHOOK_SECRET?: string;
  readonly RESEND_API_KEY?: string;
  readonly SMTP_HOST?: string;
  readonly SMTP_PORT?: string;
  readonly SMTP_SECURE?: string;
  readonly SMTP_USER?: string;
  readonly SMTP_PASS?: string;
  readonly MAIL_FROM?: string;
  readonly SMS_ENDPOINT?: string;
  readonly SMS_API_KEY?: string;
  readonly SMS_FROM?: string;
  readonly PUSH_ENDPOINT?: string;
  readonly PUSH_API_KEY?: string;
  readonly PUSH_APP_ID?: string;
  readonly BLOB_READ_WRITE_TOKEN?: string;
  readonly EXPORT_BUCKET_URL?: string;
  readonly GITHUB_API_BASE?: string;
  readonly LINEAR_API_BASE?: string;
  readonly GOOGLE_GMAIL_API_BASE?: string;
  readonly GOOGLE_CALENDAR_API_BASE?: string;
  readonly GOOGLE_TASKS_API_BASE?: string;
}

/** Service dependencies shared by API route handlers and background execution paths. */
export interface AppContainer {
  readonly billing: BillingGateway;
  readonly agentRuntime: AgentRuntime;
  readonly agentTurn: AgentTurnRuntime;
  readonly summarizer: Summarizer;
  readonly taskSynthesizer: TaskSynthesizer;
  readonly mailer: Mailer;
  readonly mcpConnector: McpConnector;
  readonly sms: SmsSender;
  readonly push: PushSender;
  readonly blob: BlobStore;
}

function localMode(runtimeEnv: AppRuntimeEnv): boolean {
  return runtimeEnv.APP_MODE === 'local' || runtimeEnv.APP_MODE === 'test';
}

function required(name: string, value: string | undefined): string {
  if (!isRealValue(value)) throw new Error(`Missing required production config: ${name}`);
  return value;
}

/** Build the container runtime configuration from the validated API environment. */
export function toAppRuntimeEnv(): AppRuntimeEnv {
  return {
    APP_MODE: env.APP_MODE,
    ...(env.STRIPE_SECRET_KEY ? { STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY } : {}),
    ...(env.STRIPE_WEBHOOK_SECRET ? { STRIPE_WEBHOOK_SECRET: env.STRIPE_WEBHOOK_SECRET } : {}),
    ...(env.STRIPE_PRICE_TEAM ? { STRIPE_PRICE_TEAM: env.STRIPE_PRICE_TEAM } : {}),
    ...(env.DOCKET_PRICE_LOOKUP_TEAM
      ? { DOCKET_PRICE_LOOKUP_TEAM: env.DOCKET_PRICE_LOOKUP_TEAM }
      : {}),
    ...(env.STRIPE_BILLING_PORTAL_CONFIG_ID
      ? { STRIPE_BILLING_PORTAL_CONFIG_ID: env.STRIPE_BILLING_PORTAL_CONFIG_ID }
      : {}),
    ...(env.ANTHROPIC_API_KEY ? { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY } : {}),
    ...(env.LINEAR_WEBHOOK_SECRET ? { LINEAR_WEBHOOK_SECRET: env.LINEAR_WEBHOOK_SECRET } : {}),
    ...(env.GITHUB_APP_WEBHOOK_SECRET
      ? { GITHUB_APP_WEBHOOK_SECRET: env.GITHUB_APP_WEBHOOK_SECRET }
      : {}),
    ...(env.RESEND_API_KEY ? { RESEND_API_KEY: env.RESEND_API_KEY } : {}),
    ...(env.SMTP_HOST ? { SMTP_HOST: env.SMTP_HOST } : {}),
    ...(env.SMTP_PORT ? { SMTP_PORT: env.SMTP_PORT } : {}),
    ...(env.SMTP_SECURE ? { SMTP_SECURE: env.SMTP_SECURE } : {}),
    ...(env.SMTP_USER ? { SMTP_USER: env.SMTP_USER } : {}),
    ...(env.SMTP_PASS ? { SMTP_PASS: env.SMTP_PASS } : {}),
    ...(env.MAIL_FROM ? { MAIL_FROM: env.MAIL_FROM } : {}),
    ...(env.SMS_ENDPOINT ? { SMS_ENDPOINT: env.SMS_ENDPOINT } : {}),
    ...(env.SMS_API_KEY ? { SMS_API_KEY: env.SMS_API_KEY } : {}),
    ...(env.SMS_FROM ? { SMS_FROM: env.SMS_FROM } : {}),
    ...(env.PUSH_ENDPOINT ? { PUSH_ENDPOINT: env.PUSH_ENDPOINT } : {}),
    ...(env.PUSH_API_KEY ? { PUSH_API_KEY: env.PUSH_API_KEY } : {}),
    ...(env.PUSH_APP_ID ? { PUSH_APP_ID: env.PUSH_APP_ID } : {}),
    ...(env.BLOB_READ_WRITE_TOKEN ? { BLOB_READ_WRITE_TOKEN: env.BLOB_READ_WRITE_TOKEN } : {}),
    ...(env.EXPORT_BUCKET_URL ? { EXPORT_BUCKET_URL: env.EXPORT_BUCKET_URL } : {}),
    ...(env.GITHUB_API_BASE ? { GITHUB_API_BASE: env.GITHUB_API_BASE } : {}),
    ...(env.LINEAR_API_BASE ? { LINEAR_API_BASE: env.LINEAR_API_BASE } : {}),
    ...(env.GOOGLE_GMAIL_API_BASE ? { GOOGLE_GMAIL_API_BASE: env.GOOGLE_GMAIL_API_BASE } : {}),
    ...(env.GOOGLE_CALENDAR_API_BASE
      ? { GOOGLE_CALENDAR_API_BASE: env.GOOGLE_CALENDAR_API_BASE }
      : {}),
    ...(env.GOOGLE_TASKS_API_BASE ? { GOOGLE_TASKS_API_BASE: env.GOOGLE_TASKS_API_BASE } : {}),
  };
}

function connectorApiBase(
  provider: ConnectorProvider,
  runtimeEnv: AppRuntimeEnv,
): string | undefined {
  switch (provider) {
    case 'github':
      return runtimeEnv.GITHUB_API_BASE;
    case 'linear':
      return runtimeEnv.LINEAR_API_BASE;
    case 'gmail':
      return runtimeEnv.GOOGLE_GMAIL_API_BASE;
    case 'calendar':
      return runtimeEnv.GOOGLE_CALENDAR_API_BASE;
    case 'gtasks':
      return runtimeEnv.GOOGLE_TASKS_API_BASE;
    default:
      return undefined;
  }
}

/**
 * Build a connector client for a provider.
 *
 * @param provider - The integration provider to connect to.
 * @param token - The provider access token used outside local/test mode.
 * @param runtimeEnv - Optional runtime configuration override for tests.
 */
export function buildConnector(
  provider: ConnectorProvider,
  token: string | undefined,
  runtimeEnv: AppRuntimeEnv = toAppRuntimeEnv(),
): Connector {
  if (localMode(runtimeEnv)) return new MockConnector({ provider });
  return new RealConnector({
    provider,
    accessToken: required(`${provider.toUpperCase()}_ACCESS_TOKEN`, token),
    ...(connectorApiBase(provider, runtimeEnv)
      ? { apiBase: connectorApiBase(provider, runtimeEnv) }
      : {}),
  });
}

/**
 * Build a webhook observer for a provider.
 *
 * @param provider - The observer provider whose webhook payloads are handled.
 * @param runtimeEnv - Optional runtime configuration override for tests.
 */
export function buildObserver(
  provider: ObserverProvider,
  runtimeEnv: AppRuntimeEnv = toAppRuntimeEnv(),
): Observer {
  if (localMode(runtimeEnv)) return new MockObserver({ provider });
  switch (provider) {
    case 'linear':
      return new RealLinearObserver({
        signingSecret: required('LINEAR_WEBHOOK_SECRET', runtimeEnv.LINEAR_WEBHOOK_SECRET),
      });
    case 'github':
      return new RealGitHubObserver({
        signingSecret: required('GITHUB_APP_WEBHOOK_SECRET', runtimeEnv.GITHUB_APP_WEBHOOK_SECRET),
      });
    default:
      throw new Error(`No active observer implementation for legacy provider: ${provider}`);
  }
}

function buildMailer(runtimeEnv: AppRuntimeEnv): Mailer {
  return buildMailerFromEnv({
    APP_MODE: runtimeEnv.APP_MODE ?? 'production',
    ...(runtimeEnv.RESEND_API_KEY ? { RESEND_API_KEY: runtimeEnv.RESEND_API_KEY } : {}),
    ...(runtimeEnv.SMTP_HOST ? { SMTP_HOST: runtimeEnv.SMTP_HOST } : {}),
    ...(runtimeEnv.SMTP_PORT ? { SMTP_PORT: runtimeEnv.SMTP_PORT } : {}),
    ...(runtimeEnv.SMTP_SECURE ? { SMTP_SECURE: runtimeEnv.SMTP_SECURE } : {}),
    ...(runtimeEnv.SMTP_USER ? { SMTP_USER: runtimeEnv.SMTP_USER } : {}),
    ...(runtimeEnv.SMTP_PASS ? { SMTP_PASS: runtimeEnv.SMTP_PASS } : {}),
    ...(runtimeEnv.MAIL_FROM ? { MAIL_FROM: runtimeEnv.MAIL_FROM } : {}),
  });
}

function buildSmsSender(runtimeEnv: AppRuntimeEnv): SmsSender {
  if (localMode(runtimeEnv)) return new CaptureSmsSender();
  const smsConfig = smsConfigFromEnv(runtimeEnv);
  if (!smsConfig) {
    throw new Error('Missing required production SMS config: SMS_ENDPOINT, SMS_API_KEY, SMS_FROM');
  }
  return new RealSmsSender(smsConfig);
}

function buildPushSender(runtimeEnv: AppRuntimeEnv): PushSender {
  if (localMode(runtimeEnv)) return new CapturePushSender();
  const pushConfig = pushConfigFromEnv(runtimeEnv);
  if (!pushConfig) {
    throw new Error(
      'Missing required production push config: PUSH_ENDPOINT, PUSH_API_KEY, PUSH_APP_ID',
    );
  }
  return new RealPushSender(pushConfig);
}

/**
 * Construct the API dependency container for the current runtime mode.
 *
 * @param runtimeEnv - Optional runtime configuration override for tests.
 */
export function buildAppContainer(runtimeEnv: AppRuntimeEnv = toAppRuntimeEnv()): AppContainer {
  const mock = localMode(runtimeEnv);
  const priceKey = runtimeEnv.STRIPE_PRICE_TEAM ?? runtimeEnv.DOCKET_PRICE_LOOKUP_TEAM;
  const billing = lazyValue(() =>
    mock
      ? new InMemoryBillingGateway()
      : new RealStripeGateway({
          secretKey: required('STRIPE_SECRET_KEY', runtimeEnv.STRIPE_SECRET_KEY),
          ...(priceKey ? { priceKey } : {}),
          ...(runtimeEnv.STRIPE_WEBHOOK_SECRET
            ? { webhookSecret: runtimeEnv.STRIPE_WEBHOOK_SECRET }
            : {}),
          ...(runtimeEnv.STRIPE_BILLING_PORTAL_CONFIG_ID
            ? { portalConfigId: runtimeEnv.STRIPE_BILLING_PORTAL_CONFIG_ID }
            : {}),
        }),
  );
  const agentRuntime = lazyValue(() =>
    mock
      ? new MockAgentRuntime()
      : new RealProviderRuntime({
          apiKey: required('ANTHROPIC_API_KEY', runtimeEnv.ANTHROPIC_API_KEY),
        }),
  );
  const agentTurn = lazyValue(() =>
    mock
      ? new MockAgentTurnRuntime()
      : new RealAgentTurnRuntime({
          apiKey: required('ANTHROPIC_API_KEY', runtimeEnv.ANTHROPIC_API_KEY),
        }),
  );
  const summarizer = lazyValue(() =>
    mock
      ? new MockSummarizer()
      : new RealSummarizer({
          apiKey: required('ANTHROPIC_API_KEY', runtimeEnv.ANTHROPIC_API_KEY),
        }),
  );
  const taskSynthesizer = lazyValue(() =>
    mock
      ? new MockTaskSynthesizer()
      : new RealTaskSynthesizer({
          apiKey: required('ANTHROPIC_API_KEY', runtimeEnv.ANTHROPIC_API_KEY),
        }),
  );
  const mailer = lazyValue(() => buildMailer(runtimeEnv));
  const mcpConnector = lazyValue(() => (mock ? new MockMcpConnector() : new RealMcpConnector()));
  const sms = lazyValue(() => buildSmsSender(runtimeEnv));
  const push = lazyValue(() => buildPushSender(runtimeEnv));
  const blob = lazyValue(() =>
    mock
      ? new LocalDiskBlob()
      : new RealBlob({
          token: required('BLOB_READ_WRITE_TOKEN', runtimeEnv.BLOB_READ_WRITE_TOKEN),
          ...(runtimeEnv.EXPORT_BUCKET_URL ? { baseUrl: runtimeEnv.EXPORT_BUCKET_URL } : {}),
        }),
  );

  return {
    get billing() {
      return billing();
    },
    get agentRuntime() {
      return agentRuntime();
    },
    get agentTurn() {
      return agentTurn();
    },
    get summarizer() {
      return summarizer();
    },
    get taskSynthesizer() {
      return taskSynthesizer();
    },
    get mailer() {
      return mailer();
    },
    get mcpConnector() {
      return mcpConnector();
    },
    get sms() {
      return sms();
    },
    get push() {
      return push();
    },
    get blob() {
      return blob();
    },
  };
}

function lazyValue<T>(create: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= create());
}

let cached: AppContainer | undefined;

/** Return the memoized process-wide API dependency container. */
export function getContainer(): AppContainer {
  return (cached ??= buildAppContainer());
}
