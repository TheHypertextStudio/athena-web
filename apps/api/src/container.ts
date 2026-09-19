import { MockAgentRuntime, RealProviderRuntime } from '@docket/athena/agent-session';
import type { AgentRuntime } from '@docket/athena/agent-session';
import type { AnthropicClientConfig } from '@docket/athena/anthropic';
import { MockSummarizer, RealSummarizer } from '@docket/athena/digest';
import type { Summarizer } from '@docket/athena/digest';
import { MockTaskSynthesizer } from '@docket/athena/task-drafting/adapters/deterministic';
import { RealTaskSynthesizer } from '@docket/athena/task-drafting/adapters/anthropic';
import type { TaskExpansionSynthesizer } from '@docket/athena/task-expansion';
import type { AgentTurnRuntime } from '@docket/athena/turn';
import { resolveModelBackend } from '@docket/athena/turn/model-backend';
import type { ModelBackendEnv } from '@docket/athena/turn/model-backend';
import { InMemoryBillingGateway } from '@docket/billing/adapters/in-memory';
import { RealStripeGateway } from '@docket/billing/adapters/stripe';
import type { BillingGateway } from '@docket/billing/contracts';
import { LocalDiskBlob, RealBlob } from '@docket/blob-store';
import type { BlobStore } from '@docket/blob-store';
import { MockNotionMirror } from '@docket/connections/notion/adapters/in-memory';
import { NotionMirrorClient } from '@docket/connections/notion/adapters/notion-sdk';
import type { NotionMirrorPort } from '@docket/connections/notion/mirror-port';
import { isRealValue } from '@docket/env';
import {
  CapturePushSender,
  CaptureSmsSender,
  LinearAgentClient,
  MockLinearAgent,
  MockMcpConnector,
  MockConnector,
  MockObserver,
  MockUnfurler,
  RealLinearAgentPort,
  RealMcpConnector,
  RealPushSender,
  RealConnector,
  RealGitHubObserver,
  RealNotionObserver,
  RealLinearObserver,
  RealSmsSender,
  RealUnfurler,
  pushConfigFromEnv,
  smsConfigFromEnv,
} from '@docket/integrations';
import type {
  Connector,
  ConnectorProvider,
  LinearAgentPort,
  McpConnector,
  Observer,
  ObserverProvider,
  PushSender,
  SmsSender,
  Unfurler,
} from '@docket/integrations';
import { buildInboundReceiverFromEnv, buildMailerFromEnv } from '@docket/mail';
import type { InboundMailReceiver, Mailer } from '@docket/mail';
import { configureNotificationTransports } from '@docket/notifications/dispatch';
import type { TaskSynthesizer } from '@docket/work/task-drafting';

import { toAppRuntimeEnv } from './container-runtime-env';
import {
  CapturePhoneVerificationProvider,
  type PhoneVerificationProvider,
  TwilioVerifyProvider,
} from './routes/phone-verification-provider';
import {
  CaptureTelephonyProvider,
  type TelephonyProvider,
  TwilioTelephony,
} from './routes/twilio-telephony';
import { resolveVoiceProvider, type VoiceRealtimeProvider } from './routes/voice-provider';
import {
  DeterministicPlaceGeocoder,
  MapboxPlaceGeocoder,
  type PlaceGeocoder,
} from './services/work-location/place-geocoder';

/** Runtime configuration values used to choose local mocks or production services. */
export interface AppRuntimeEnv {
  readonly APP_MODE?: 'local' | 'test' | 'production';
  readonly PHONE_VERIFICATION_ENABLED?: boolean;
  readonly PHONE_VERIFICATION_CANARY_EMAILS?: string;
  readonly BILLING_ENABLED?: boolean;
  readonly BILLING_CANARY_EMAILS?: string;
  readonly STRIPE_SECRET_KEY?: string;
  readonly STRIPE_HYPERTEXT_STUDIO_ACCOUNT_ID?: string;
  readonly STRIPE_WEBHOOK_SECRET?: string;
  readonly STRIPE_PRICE_DOCKET_PRO?: string;
  readonly DOCKET_PRICE_LOOKUP_DOCKET_PRO?: string;
  /** @deprecated One-release compatibility alias for Docket Pro. */
  readonly STRIPE_PRICE_TEAM?: string;
  /** @deprecated One-release compatibility alias for Docket Pro. */
  readonly DOCKET_PRICE_LOOKUP_TEAM?: string;
  readonly STRIPE_BILLING_PORTAL_CONFIG_ID?: string;
  readonly STRIPE_SINGLE_SUBSCRIPTION_REDIRECT_VERIFIED_AT?: string;
  readonly ANTHROPIC_API_KEY?: string;
  readonly CLOUDFLARE_AI_GATEWAY_BASE_URL?: string;
  readonly CLOUDFLARE_AI_GATEWAY_TOKEN?: string;
  readonly GOOGLE_CLOUD_PROJECT?: string;
  readonly GOOGLE_CLOUD_LOCATION?: string;
  readonly ATHENA_MODEL?: string;
  readonly LINEAR_WEBHOOK_SECRET?: string;
  readonly NOTION_WEBHOOK_TOKEN?: string;
  readonly GITHUB_APP_WEBHOOK_SECRET?: string;
  readonly RESEND_API_KEY?: string;
  readonly RESEND_INBOUND_WEBHOOK_SECRET?: string;
  readonly RESEND_RECEIVING_API_BASE?: string;
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
  readonly OPENAI_API_KEY?: string;
  readonly VOICE_REALTIME_MODEL?: string;
  readonly VOICE_REALTIME_VOICE?: string;
  readonly TWILIO_ACCOUNT_SID?: string;
  readonly TWILIO_AUTH_TOKEN?: string;
  readonly TWILIO_PHONE_NUMBER?: string;
  readonly TWILIO_VERIFY_API_KEY_SID?: string;
  readonly TWILIO_VERIFY_API_KEY_SECRET?: string;
  readonly TWILIO_VERIFY_SERVICE_SID?: string;
  readonly MAPBOX_ACCESS_TOKEN?: string;
}

/** Service dependencies shared by API route handlers and background execution paths. */
export interface AppContainer {
  readonly billing: BillingGateway;
  readonly agentRuntime: AgentRuntime;
  readonly agentTurn: AgentTurnRuntime;
  readonly summarizer: Summarizer;
  readonly taskSynthesizer: TaskSynthesizer;
  /** The task-description expansion boundary. */
  readonly taskExpander: TaskExpansionSynthesizer;
  readonly mailer: Mailer;
  /** The receiving edge: authenticates and normalizes one inbound-mail webhook request. */
  readonly inboundMail: InboundMailReceiver;
  readonly mcpConnector: McpConnector;
  readonly sms: SmsSender;
  /** Provider-owned phone-number verification boundary. */
  readonly phoneVerification: PhoneVerificationProvider;
  /** Outbound calls and active-call termination. */
  readonly telephony: TelephonyProvider;
  readonly push: PushSender;
  /** The realtime speech backend behind Athena's browser voice mode. */
  readonly voice: VoiceRealtimeProvider;
  readonly blob: BlobStore;
  readonly unfurler: Unfurler;
  /** Address-search provider for user-owned saved places. */
  readonly placeGeocoder: PlaceGeocoder;
}

function localMode(runtimeEnv: AppRuntimeEnv): boolean {
  return runtimeEnv.APP_MODE === 'local' || runtimeEnv.APP_MODE === 'test';
}

function required(name: string, value: string | undefined): string {
  if (!isRealValue(value)) throw new Error(`Missing required production config: ${name}`);
  return value;
}

/**
 * Project the container's runtime configuration onto the model-backend seam's own input.
 *
 * @remarks
 * The seam reads a deliberately small slice — which tier, which endpoint, which credential — so
 * that adding a backend never means widening this container's environment surface.
 */
export function toModelBackendEnv(runtimeEnv: AppRuntimeEnv): ModelBackendEnv {
  return {
    ...(runtimeEnv.APP_MODE ? { APP_MODE: runtimeEnv.APP_MODE } : {}),
    ...(runtimeEnv.ANTHROPIC_API_KEY ? { ANTHROPIC_API_KEY: runtimeEnv.ANTHROPIC_API_KEY } : {}),
    ...(runtimeEnv.CLOUDFLARE_AI_GATEWAY_BASE_URL
      ? { CLOUDFLARE_AI_GATEWAY_BASE_URL: runtimeEnv.CLOUDFLARE_AI_GATEWAY_BASE_URL }
      : {}),
    ...(runtimeEnv.CLOUDFLARE_AI_GATEWAY_TOKEN
      ? { CLOUDFLARE_AI_GATEWAY_TOKEN: runtimeEnv.CLOUDFLARE_AI_GATEWAY_TOKEN }
      : {}),
    ...(runtimeEnv.GOOGLE_CLOUD_PROJECT
      ? { GOOGLE_CLOUD_PROJECT: runtimeEnv.GOOGLE_CLOUD_PROJECT }
      : {}),
    ...(runtimeEnv.GOOGLE_CLOUD_LOCATION
      ? { GOOGLE_CLOUD_LOCATION: runtimeEnv.GOOGLE_CLOUD_LOCATION }
      : {}),
    ...(runtimeEnv.ATHENA_MODEL ? { ATHENA_MODEL: runtimeEnv.ATHENA_MODEL } : {}),
  };
}

/** Resolve the shared direct-or-Gateway Anthropic configuration for live Athena adapters. */
export function anthropicConfigFromEnv(runtimeEnv: AppRuntimeEnv): AnthropicClientConfig {
  const apiKey = required('ANTHROPIC_API_KEY', runtimeEnv.ANTHROPIC_API_KEY);
  const baseURL = runtimeEnv.CLOUDFLARE_AI_GATEWAY_BASE_URL;
  const gatewayToken = runtimeEnv.CLOUDFLARE_AI_GATEWAY_TOKEN;
  return baseURL && gatewayToken ? { apiKey, baseURL, gatewayToken } : { apiKey };
}

export { toAppRuntimeEnv } from './container-runtime-env';

/** Build the real Stripe boundary without consulting the public Checkout feature flag. */
export function buildStripeBillingGateway(runtimeEnv: AppRuntimeEnv): BillingGateway {
  const priceKey =
    runtimeEnv.STRIPE_PRICE_DOCKET_PRO ??
    runtimeEnv.DOCKET_PRICE_LOOKUP_DOCKET_PRO ??
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- One-release compatibility for the former Docket Team configuration.
    runtimeEnv.STRIPE_PRICE_TEAM ??
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- One-release compatibility for the former Docket Team configuration.
    runtimeEnv.DOCKET_PRICE_LOOKUP_TEAM;
  return new RealStripeGateway({
    secretKey: required('STRIPE_SECRET_KEY', runtimeEnv.STRIPE_SECRET_KEY),
    expectedAccountId: required(
      'STRIPE_HYPERTEXT_STUDIO_ACCOUNT_ID',
      runtimeEnv.STRIPE_HYPERTEXT_STUDIO_ACCOUNT_ID,
    ),
    ...(priceKey ? { priceKey } : {}),
    ...(runtimeEnv.STRIPE_WEBHOOK_SECRET
      ? { webhookSecret: runtimeEnv.STRIPE_WEBHOOK_SECRET }
      : {}),
    ...(runtimeEnv.STRIPE_BILLING_PORTAL_CONFIG_ID
      ? { portalConfigId: runtimeEnv.STRIPE_BILLING_PORTAL_CONFIG_ID }
      : {}),
  });
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

const localNotionMirrors = new Map<string, MockNotionMirror>();

interface NotionMirrorBuildOptions {
  readonly runtimeEnv?: AppRuntimeEnv;
  readonly integrationId?: string;
}

/**
 * Build the Notion mirror client for one integration.
 *
 * @param token - The provider access token used outside local/test mode.
 * @param options - Runtime override and local integration scope.
 * @returns the real provider client or an integration-scoped local adapter.
 */
export function buildNotionMirror(
  token: string | undefined,
  options: NotionMirrorBuildOptions = {},
): NotionMirrorPort {
  const runtimeEnv = options.runtimeEnv ?? toAppRuntimeEnv();
  // Same seam as `buildConnector`: the whole provision → project → pull-back flow has to run on a
  // laptop with no Notion workspace, per the zero-external-accounts rule.
  if (localMode(runtimeEnv)) {
    const { integrationId } = options;
    if (integrationId === undefined) return new MockNotionMirror();
    const existing = localNotionMirrors.get(integrationId);
    if (existing !== undefined) return existing;
    const created = new MockNotionMirror();
    localNotionMirrors.set(integrationId, created);
    return created;
  }
  return new NotionMirrorClient(required('NOTION_ACCESS_TOKEN', token));
}

/**
 * Build the connector for a provider, mocked in local/test mode.
 *
 * @param provider - The connector provider.
 * @param token - The OAuth access token.
 * @param runtimeEnv - Optional runtime configuration override for tests.
 */
export function buildConnector(
  provider: ConnectorProvider,
  token: string | undefined,
  runtimeEnv: AppRuntimeEnv = toAppRuntimeEnv(),
): Connector {
  // `now` is supplied in local mode so the mock's activity fixtures land in *today's* window.
  // Without it the mock anchors to its fixed sample instant, and the whole offline pipeline —
  // poll, narrate, review — would correctly find nothing every day after the fixtures were written.
  if (localMode(runtimeEnv)) return new MockConnector({ provider, now: new Date().toISOString() });
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
    case 'notion':
      return new RealNotionObserver({
        verificationToken: required('NOTION_WEBHOOK_TOKEN', runtimeEnv.NOTION_WEBHOOK_TOKEN),
      });
    default:
      throw new Error(`No active observer implementation for legacy provider: ${provider}`);
  }
}

/**
 * Build a Linear **Agent** platform client for one workspace's install.
 *
 * @remarks
 * Distinct from {@link buildConnector}'s `linear` case: that builds the data-sync connector
 * client, this builds the app-level Agent boundary client an org's stored `linear_agent`
 * credential authenticates. Returns the {@link LinearAgentPort} interface rather than the
 * concrete real/mock class: the real {@link LinearAgentClient} is a thin GraphQL transport
 * (`client.query(...)`) that the free functions `agentActivityCreate`/`agentSessionUpdate` from
 * `@docket/integrations` wrap, while {@link MockLinearAgent} exposes those same names directly as
 * instance methods (no `client` argument, no network) — {@link RealLinearAgentPort} adapts the
 * former to the latter's shape so every caller (the webhook receiver, the outbound relay) calls
 * `client.agentActivityCreate(input)`/`client.agentSessionUpdate(input)` uniformly, real or mock,
 * with no `instanceof` branching.
 *
 * @param accessToken - The workspace's unsealed Agent install access token (required in
 *   production; ignored in local/test mode, where the mock needs no credential).
 * @param runtimeEnv - Optional runtime configuration override for tests.
 */
export function buildLinearAgentClient(
  accessToken: string | undefined,
  runtimeEnv: AppRuntimeEnv = toAppRuntimeEnv(),
): LinearAgentPort {
  if (localMode(runtimeEnv)) return new MockLinearAgent();
  return new RealLinearAgentPort(
    new LinearAgentClient(required('LINEAR_AGENT_ACCESS_TOKEN', accessToken)),
  );
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

/**
 * Build the inbound-mail receiver for the current mode.
 *
 * @remarks
 * The receiving mirror of {@link buildMailer}. Local and test always get the offline fixture
 * adapter, so the whole delivery pipeline runs with no provider account; production requires
 * both the API key and the webhook signing secret and refuses to construct without them, because
 * an unauthenticated receiving endpoint is worse than no receiving endpoint.
 */
function buildInboundReceiver(runtimeEnv: AppRuntimeEnv): InboundMailReceiver {
  return buildInboundReceiverFromEnv({
    APP_MODE: runtimeEnv.APP_MODE ?? 'production',
    ...(runtimeEnv.RESEND_API_KEY ? { RESEND_API_KEY: runtimeEnv.RESEND_API_KEY } : {}),
    ...(runtimeEnv.RESEND_INBOUND_WEBHOOK_SECRET
      ? { RESEND_INBOUND_WEBHOOK_SECRET: runtimeEnv.RESEND_INBOUND_WEBHOOK_SECRET }
      : {}),
    ...(runtimeEnv.RESEND_RECEIVING_API_BASE
      ? { RESEND_RECEIVING_API_BASE: runtimeEnv.RESEND_RECEIVING_API_BASE }
      : {}),
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

function buildPhoneVerificationProvider(runtimeEnv: AppRuntimeEnv): PhoneVerificationProvider {
  if (localMode(runtimeEnv)) return new CapturePhoneVerificationProvider();
  const config = twilioVerifyConfig(runtimeEnv);
  return new TwilioVerifyProvider({
    apiKeySid: config.apiKeySid,
    apiKeySecret: config.apiKeySecret,
    serviceSid: config.serviceSid,
  });
}

function buildTelephonyProvider(runtimeEnv: AppRuntimeEnv): TelephonyProvider {
  if (localMode(runtimeEnv)) return new CaptureTelephonyProvider();
  const config = twilioVoiceConfig(runtimeEnv);
  return new TwilioTelephony({
    accountSid: config.accountSid,
    authToken: config.authToken,
    from: config.phoneNumber,
  });
}

/** Validate the production voice configuration independently from Verify. */
function twilioVoiceConfig(runtimeEnv: AppRuntimeEnv): {
  readonly accountSid: string;
  readonly authToken: string;
  readonly phoneNumber: string;
} {
  return {
    accountSid: required('TWILIO_ACCOUNT_SID', runtimeEnv.TWILIO_ACCOUNT_SID),
    authToken: required('TWILIO_AUTH_TOKEN', runtimeEnv.TWILIO_AUTH_TOKEN),
    phoneNumber: required('TWILIO_PHONE_NUMBER', runtimeEnv.TWILIO_PHONE_NUMBER),
  };
}

/** Validate the production Verify credentials without requiring a voice number. */
function twilioVerifyConfig(runtimeEnv: AppRuntimeEnv): {
  readonly apiKeySid: string;
  readonly apiKeySecret: string;
  readonly serviceSid: string;
} {
  return {
    apiKeySid: required('TWILIO_VERIFY_API_KEY_SID', runtimeEnv.TWILIO_VERIFY_API_KEY_SID),
    apiKeySecret: required('TWILIO_VERIFY_API_KEY_SECRET', runtimeEnv.TWILIO_VERIFY_API_KEY_SECRET),
    serviceSid: required('TWILIO_VERIFY_SERVICE_SID', runtimeEnv.TWILIO_VERIFY_SERVICE_SID),
  };
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

function usesRealBilling(runtimeEnv: AppRuntimeEnv): boolean {
  if (!localMode(runtimeEnv)) return true;
  if (runtimeEnv.APP_MODE !== 'local') return false;
  const hasCanary =
    runtimeEnv.BILLING_CANARY_EMAILS?.split(',').some((email) => email.trim().length > 0) ?? false;
  return runtimeEnv.BILLING_ENABLED === true || hasCanary;
}

function buildPlaceGeocoder(runtimeEnv: AppRuntimeEnv): PlaceGeocoder {
  if (localMode(runtimeEnv)) return new DeterministicPlaceGeocoder();
  return new MapboxPlaceGeocoder({
    accessToken: required('MAPBOX_ACCESS_TOKEN', runtimeEnv.MAPBOX_ACCESS_TOKEN),
  });
}

/** Every boundary, as a thunk that constructs it on first use. */
type LazyBoundaries = {
  readonly [K in keyof AppContainer]: () => AppContainer[K];
};

/**
 * Build one thunk per boundary, resolving each through the real/mock seam.
 *
 * @remarks
 * Lazy throughout: production refuses to build several of these without a credential, and a deploy
 * that never sends mail, receives mail, or opens a voice session must not be blocked at boot by a
 * credential it does not use.
 *
 * @param runtimeEnv - The runtime configuration.
 * @returns The thunks {@link buildAppContainer} exposes as getters.
 */
function buildLazyBoundaries(runtimeEnv: AppRuntimeEnv): LazyBoundaries {
  const mock = localMode(runtimeEnv);
  const billing = lazyValue(() =>
    usesRealBilling(runtimeEnv)
      ? buildStripeBillingGateway(runtimeEnv)
      : new InMemoryBillingGateway(),
  );
  const agentRuntime = lazyValue(() =>
    mock ? new MockAgentRuntime() : new RealProviderRuntime(anthropicConfigFromEnv(runtimeEnv)),
  );
  // Athena's turns go through the model-backend seam rather than being constructed here, so
  // "which model, reached how, paid for by whom" is one decision with one implementation:
  // Cloudflare's model router on Docket's keys by default, an operator's own Lovelace Lattice
  // instance when they configure one, and the deterministic script locally.
  const modelBackend = lazyValue(() => resolveModelBackend(toModelBackendEnv(runtimeEnv)));
  const agentTurn = lazyValue(() => modelBackend().turnRuntime());
  const summarizer = lazyValue(() =>
    mock ? new MockSummarizer() : new RealSummarizer(anthropicConfigFromEnv(runtimeEnv)),
  );
  const taskSynthesizer = lazyValue(() =>
    mock ? new MockTaskSynthesizer() : new RealTaskSynthesizer(anthropicConfigFromEnv(runtimeEnv)),
  );
  const taskExpander = lazyValue(() =>
    mock ? new MockTaskSynthesizer() : new RealTaskSynthesizer(anthropicConfigFromEnv(runtimeEnv)),
  );
  const mailer = lazyValue(() => buildMailer(runtimeEnv));
  const inboundMail = lazyValue(() => buildInboundReceiver(runtimeEnv));
  const mcpConnector = lazyValue(() => (mock ? new MockMcpConnector() : new RealMcpConnector()));
  const sms = lazyValue(() => buildSmsSender(runtimeEnv));
  const phoneVerification = lazyValue(() => buildPhoneVerificationProvider(runtimeEnv));
  const telephony = lazyValue(() => buildTelephonyProvider(runtimeEnv));
  const voice = lazyValue(() => resolveVoiceProvider(runtimeEnv));
  const push = lazyValue(() => buildPushSender(runtimeEnv));
  const unfurler = lazyValue(() => (mock ? new MockUnfurler() : new RealUnfurler()));
  const blob = lazyValue(() =>
    mock
      ? new LocalDiskBlob()
      : new RealBlob({
          token: required('BLOB_READ_WRITE_TOKEN', runtimeEnv.BLOB_READ_WRITE_TOKEN),
          ...(runtimeEnv.EXPORT_BUCKET_URL ? { baseUrl: runtimeEnv.EXPORT_BUCKET_URL } : {}),
        }),
  );
  const placeGeocoder = lazyValue(() => buildPlaceGeocoder(runtimeEnv));

  return {
    billing,
    agentRuntime,
    agentTurn,
    summarizer,
    taskSynthesizer,
    taskExpander,
    mailer,
    inboundMail,
    mcpConnector,
    sms,
    phoneVerification,
    telephony,
    voice,
    push,
    blob,
    unfurler,
    placeGeocoder,
  };
}

/**
 * Expose each thunk as a getter, so reading a boundary constructs it and nothing else.
 *
 * @remarks
 * Defined rather than written out one property at a time: the container's shape is already stated
 * by {@link AppContainer}, and a hand-written getter per boundary is a second copy of that list
 * for a reader to check against the first.
 *
 * @param lazy - One thunk per boundary.
 * @returns The container.
 */
function toLazyContainer(lazy: LazyBoundaries): AppContainer {
  const container = {} as AppContainer;
  for (const [key, get] of Object.entries(lazy)) {
    Object.defineProperty(container, key, { get, enumerable: true });
  }
  return container;
}

/**
 * Construct the API dependency container for the current runtime mode.
 *
 * @param runtimeEnv - Optional runtime configuration override for tests.
 * @returns The container; every boundary constructs on first access.
 */
export function buildAppContainer(runtimeEnv: AppRuntimeEnv = toAppRuntimeEnv()): AppContainer {
  const lazy = buildLazyBoundaries(runtimeEnv);
  const built = toLazyContainer(lazy);

  // `@docket/notifications/dispatch`'s adapters have no DI container of their own — register this
  // container's own lazy mailer/sms/push accessors once so a dispatch from ANY caller in this
  // process (this app's routes, or `@docket/auth`'s recovery hooks) resolves the same transports
  // this container itself would, without forcing early construction of ones nothing uses yet.
  configureNotificationTransports({ mailer: lazy.mailer, sms: lazy.sms, push: lazy.push });

  return built;
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
