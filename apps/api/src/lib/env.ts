/**
 * Environment configuration with Zod validation.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

/**
 * Core environment schema - these are always required.
 */
const coreSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']),
  PORT: z.coerce.number(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']),
  DATABASE_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  FRONTEND_URL: z.url(),

  // Google OAuth - required for auth and calendar sync
  GOOGLE_CLIENT_ID: z.string().min(1, 'GOOGLE_CLIENT_ID is required'),
  GOOGLE_CLIENT_SECRET: z.string().min(1, 'GOOGLE_CLIENT_SECRET is required'),
  GOOGLE_CALENDAR_REDIRECT_URI: z.url(),
});

/**
 * Optional service configurations.
 * These are only included if their required fields are present.
 */
const optionalServicesSchema = z.object({
  // Other OAuth providers (Google is required in core schema)
  APPLE_CLIENT_ID: z.string().optional(),
  APPLE_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),

  // Calendar redirect URIs
  OUTLOOK_CALENDAR_REDIRECT_URI: z.string().optional(),
  CALENDAR_OAUTH_STATE_SECRET: z.string().optional(),
  DATA_ENCRYPTION_KEY: z.string().optional(),

  // Public API URL for webhooks (e.g., https://api.athena.app)
  // Used for Google/Outlook calendar webhook callbacks
  API_PUBLIC_URL: z.url().optional(),

  // Integration providers
  LINEAR_OAUTH_CLIENT_ID: z.string().optional(),
  LINEAR_OAUTH_CLIENT_SECRET: z.string().optional(),
  LINEAR_OAUTH_REDIRECT_URI: z.string().optional(),
  LINEAR_WEBHOOK_SECRET: z.string().optional(),
  GITHUB_OAUTH_CLIENT_ID: z.string().optional(),
  GITHUB_OAUTH_CLIENT_SECRET: z.string().optional(),
  GITHUB_OAUTH_REDIRECT_URI: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),

  // AI providers
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_ORGANIZATION_ID: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_DEFAULT_PROVIDER: z.enum(['openai', 'anthropic']).optional(),

  // Email
  EMAIL_PROVIDER: z.enum(['resend', 'smtp']).optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_SENDER_ADDRESS: z.email().optional(),
  EMAIL_SENDER_NAME: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_SECURE: z.coerce.boolean().optional(),
  SMTP_USERNAME: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),

  // SMS
  SMS_PROVIDER: z.enum(['twilio', 'vonage']).optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),

  // Slack
  SLACK_WEBHOOK_URL: z.url().optional(),

  // Push notifications
  WEB_PUSH_VAPID_PUBLIC_KEY: z.string().optional(),
  WEB_PUSH_VAPID_PRIVATE_KEY: z.string().optional(),
  WEB_PUSH_VAPID_SUBJECT: z.string().optional(),
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),

  // Storage
  STORAGE_PROVIDER: z.enum(['local', 's3']).optional(),
  STORAGE_LOCAL_PATH: z.string().optional(),
  AWS_S3_BUCKET: z.string().optional(),
  AWS_S3_REGION: z.string().optional(),
  AWS_S3_ACCESS_KEY_ID: z.string().optional(),
  AWS_S3_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_S3_ENDPOINT: z.string().optional(),
  STORAGE_PUBLIC_URL_BASE: z.url().optional(),
  STORAGE_MAX_FILE_SIZE: z.coerce.number().optional(),

  // Billing
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_ID_PRO_MONTHLY: z.string().optional(),
  STRIPE_PRICE_ID_PRO_YEARLY: z.string().optional(),
  STRIPE_PRICE_ID_TEAM_MONTHLY: z.string().optional(),
  STRIPE_PRICE_ID_TEAM_YEARLY: z.string().optional(),

  // Observability
  SENTRY_DSN: z.url().optional(),

  // RISC (Cross-Account Protection)
  // Uses Application Default Credentials (ADC) by default.
  // Falls back to explicit credentials if ADC not available.
  GOOGLE_RISC_SERVICE_ACCOUNT_EMAIL: z.email().optional(),
  GOOGLE_RISC_PRIVATE_KEY: z.string().optional(),
  RISC_WEBHOOK_URL: z.url().optional(),
  // Set to 'true' to disable ADC and force explicit credentials
  GOOGLE_RISC_DISABLE_ADC: z.coerce.boolean().optional(),

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().optional(),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().optional(),
});

const envSchema = coreSchema.extend(optionalServicesSchema.shape);

type RawEnv = z.infer<typeof envSchema>;

/** OAuth provider config. */
interface OAuthConfig {
  clientId: string;
  clientSecret: string;
}

/** Calendar provider config. */
interface CalendarConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** Integration provider config. */
interface IntegrationConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  webhookSecret?: string;
}

/** Email provider config. */
interface EmailConfig {
  apiKey: string;
  senderAddress: string;
  senderName: string;
}

/** SMS provider config. */
interface SmsConfig {
  accountSid: string;
  authToken: string;
  phoneNumber: string;
}

/** Stripe billing config. */
interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
}

/** OpenAI config. */
interface OpenAIConfig {
  apiKey: string;
  organizationId?: string;
}

/** Anthropic config. */
interface AnthropicConfig {
  apiKey: string;
}

/** S3 storage config. */
interface S3Config {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
}

/** RISC (Cross-Account Protection) config. */
interface RiscConfig {
  /** Webhook URL for receiving RISC events. */
  webhookUrl: string;
  /** Whether to use Application Default Credentials. */
  useAdc: boolean;
  /** Service account email (only used if not using ADC). */
  serviceAccountEmail?: string;
  /** Service account private key (only used if not using ADC). */
  privateKey?: string;
}

/**
 * Parsed and validated environment variables.
 * Computed config objects are only present when all required fields are set.
 */
export interface Env extends RawEnv {
  googleOAuth?: OAuthConfig;
  microsoftOAuth?: OAuthConfig;
  appleOAuth?: OAuthConfig;
  googleCalendar?: CalendarConfig;
  outlookCalendar?: CalendarConfig;
  linearIntegration?: IntegrationConfig;
  githubIntegration?: IntegrationConfig;
  resendEmail?: EmailConfig;
  twilioSms?: SmsConfig;
  stripeConfig?: StripeConfig;
  openaiConfig?: OpenAIConfig;
  anthropicConfig?: AnthropicConfig;
  s3Storage?: S3Config;
  riscConfig?: RiscConfig;
}

/**
 * Check if all required keys are present. Throws if partially configured.
 */
function checkRequiredKeys(
  raw: RawEnv,
  name: string,
  requiredKeys: (keyof RawEnv)[],
  optionalKeys: (keyof RawEnv)[] = [],
): boolean {
  const allKeys = [...requiredKeys, ...optionalKeys];
  const setKeys = allKeys.filter((key) => raw[key] !== undefined);

  if (setKeys.length === 0) {
    return false; // Not configured at all
  }

  const missingRequired = requiredKeys.filter((key) => raw[key] === undefined);
  if (missingRequired.length > 0) {
    const missing = missingRequired.join(', ');
    const present = setKeys.join(', ');
    throw new Error(
      `${name} is partially configured. Present: [${present}]. Missing required: [${missing}]`,
    );
  }

  return true; // Fully configured
}

/**
 * Build OAuth config if fully configured.
 */
function buildOAuthConfig(
  raw: RawEnv,
  name: string,
  clientIdKey: keyof RawEnv,
  clientSecretKey: keyof RawEnv,
): OAuthConfig | undefined {
  if (!checkRequiredKeys(raw, name, [clientIdKey, clientSecretKey])) {
    return undefined;
  }
  const clientId = raw[clientIdKey];
  const clientSecret = raw[clientSecretKey];
  if (typeof clientId === 'string' && typeof clientSecret === 'string') {
    return { clientId, clientSecret };
  }
  return undefined;
}

/**
 * Build calendar config if fully configured.
 */
function buildCalendarConfig(
  raw: RawEnv,
  name: string,
  clientIdKey: keyof RawEnv,
  clientSecretKey: keyof RawEnv,
  redirectUriKey: keyof RawEnv,
): CalendarConfig | undefined {
  if (!checkRequiredKeys(raw, name, [clientIdKey, clientSecretKey, redirectUriKey])) {
    return undefined;
  }
  const clientId = raw[clientIdKey];
  const clientSecret = raw[clientSecretKey];
  const redirectUri = raw[redirectUriKey];
  if (
    typeof clientId === 'string' &&
    typeof clientSecret === 'string' &&
    typeof redirectUri === 'string'
  ) {
    return { clientId, clientSecret, redirectUri };
  }
  return undefined;
}

/**
 * Build integration config if fully configured.
 */
function buildIntegrationConfig(
  raw: RawEnv,
  name: string,
  clientIdKey: keyof RawEnv,
  clientSecretKey: keyof RawEnv,
  redirectUriKey: keyof RawEnv,
  webhookSecretKey?: keyof RawEnv,
): IntegrationConfig | undefined {
  const optionalKeys = webhookSecretKey ? [webhookSecretKey] : [];
  if (!checkRequiredKeys(raw, name, [clientIdKey, clientSecretKey, redirectUriKey], optionalKeys)) {
    return undefined;
  }
  const clientId = raw[clientIdKey];
  const clientSecret = raw[clientSecretKey];
  const redirectUri = raw[redirectUriKey];
  const webhookSecret = webhookSecretKey ? raw[webhookSecretKey] : undefined;
  if (
    typeof clientId === 'string' &&
    typeof clientSecret === 'string' &&
    typeof redirectUri === 'string'
  ) {
    return {
      clientId,
      clientSecret,
      redirectUri,
      webhookSecret: typeof webhookSecret === 'string' ? webhookSecret : undefined,
    };
  }
  return undefined;
}

function getEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = z.treeifyError(result.error);
    throw new Error(`Environment validation failed:\n${JSON.stringify(formatted, null, 2)}`);
  }

  const raw = result.data;

  if (raw.NODE_ENV === 'production' && !raw.DATA_ENCRYPTION_KEY) {
    throw new Error('DATA_ENCRYPTION_KEY is required in production');
  }

  const env: Env = { ...raw };

  // OAuth providers - use standard credential names
  env.googleOAuth = buildOAuthConfig(
    raw,
    'Google OAuth',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
  );

  env.microsoftOAuth = buildOAuthConfig(
    raw,
    'Microsoft OAuth',
    'MICROSOFT_CLIENT_ID',
    'MICROSOFT_CLIENT_SECRET',
  );

  env.appleOAuth = buildOAuthConfig(raw, 'Apple OAuth', 'APPLE_CLIENT_ID', 'APPLE_CLIENT_SECRET');

  // Calendar providers - reuse OAuth credentials, just need redirect URI
  env.googleCalendar = buildCalendarConfig(
    raw,
    'Google Calendar',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_CALENDAR_REDIRECT_URI',
  );

  env.outlookCalendar = buildCalendarConfig(
    raw,
    'Outlook Calendar',
    'MICROSOFT_CLIENT_ID',
    'MICROSOFT_CLIENT_SECRET',
    'OUTLOOK_CALENDAR_REDIRECT_URI',
  );

  // Integration providers
  env.linearIntegration = buildIntegrationConfig(
    raw,
    'Linear Integration',
    'LINEAR_OAUTH_CLIENT_ID',
    'LINEAR_OAUTH_CLIENT_SECRET',
    'LINEAR_OAUTH_REDIRECT_URI',
    'LINEAR_WEBHOOK_SECRET',
  );

  env.githubIntegration = buildIntegrationConfig(
    raw,
    'GitHub Integration',
    'GITHUB_OAUTH_CLIENT_ID',
    'GITHUB_OAUTH_CLIENT_SECRET',
    'GITHUB_OAUTH_REDIRECT_URI',
    'GITHUB_WEBHOOK_SECRET',
  );

  // Resend Email
  if (raw.EMAIL_PROVIDER === 'resend') {
    if (
      checkRequiredKeys(
        raw,
        'Resend Email',
        ['RESEND_API_KEY', 'EMAIL_SENDER_ADDRESS'],
        ['EMAIL_SENDER_NAME'],
      )
    ) {
      const apiKey = raw.RESEND_API_KEY;
      const senderAddress = raw.EMAIL_SENDER_ADDRESS;
      if (typeof apiKey === 'string' && typeof senderAddress === 'string') {
        env.resendEmail = {
          apiKey,
          senderAddress,
          senderName: raw.EMAIL_SENDER_NAME ?? 'Project Athena',
        };
      }
    }
  }

  // Twilio SMS
  if (raw.SMS_PROVIDER === 'twilio') {
    if (
      checkRequiredKeys(raw, 'Twilio SMS', [
        'TWILIO_ACCOUNT_SID',
        'TWILIO_AUTH_TOKEN',
        'TWILIO_PHONE_NUMBER',
      ])
    ) {
      const accountSid = raw.TWILIO_ACCOUNT_SID;
      const authToken = raw.TWILIO_AUTH_TOKEN;
      const phoneNumber = raw.TWILIO_PHONE_NUMBER;
      if (
        typeof accountSid === 'string' &&
        typeof authToken === 'string' &&
        typeof phoneNumber === 'string'
      ) {
        env.twilioSms = { accountSid, authToken, phoneNumber };
      }
    }
  }

  // Stripe
  if (checkRequiredKeys(raw, 'Stripe', ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'])) {
    const secretKey = raw.STRIPE_SECRET_KEY;
    const webhookSecret = raw.STRIPE_WEBHOOK_SECRET;
    if (typeof secretKey === 'string' && typeof webhookSecret === 'string') {
      env.stripeConfig = { secretKey, webhookSecret };
    }
  }

  // OpenAI
  if (checkRequiredKeys(raw, 'OpenAI', ['OPENAI_API_KEY'], ['OPENAI_ORGANIZATION_ID'])) {
    const apiKey = raw.OPENAI_API_KEY;
    if (typeof apiKey === 'string') {
      env.openaiConfig = {
        apiKey,
        organizationId: raw.OPENAI_ORGANIZATION_ID,
      };
    }
  }

  // Anthropic
  if (raw.ANTHROPIC_API_KEY) {
    env.anthropicConfig = { apiKey: raw.ANTHROPIC_API_KEY };
  }

  // S3 Storage
  if (raw.STORAGE_PROVIDER === 's3') {
    if (
      checkRequiredKeys(
        raw,
        'S3 Storage',
        ['AWS_S3_BUCKET', 'AWS_S3_REGION', 'AWS_S3_ACCESS_KEY_ID', 'AWS_S3_SECRET_ACCESS_KEY'],
        ['AWS_S3_ENDPOINT'],
      )
    ) {
      const bucket = raw.AWS_S3_BUCKET;
      const region = raw.AWS_S3_REGION;
      const accessKeyId = raw.AWS_S3_ACCESS_KEY_ID;
      const secretAccessKey = raw.AWS_S3_SECRET_ACCESS_KEY;
      if (
        typeof bucket === 'string' &&
        typeof region === 'string' &&
        typeof accessKeyId === 'string' &&
        typeof secretAccessKey === 'string'
      ) {
        env.s3Storage = {
          bucket,
          region,
          accessKeyId,
          secretAccessKey,
          endpoint: raw.AWS_S3_ENDPOINT,
        };
      }
    }
  }

  // RISC (Cross-Account Protection)
  // Requires webhook URL at minimum. Uses ADC by default, falls back to explicit credentials.
  if (raw.RISC_WEBHOOK_URL) {
    const disableAdc = raw.GOOGLE_RISC_DISABLE_ADC === true;
    const hasExplicitCredentials =
      raw.GOOGLE_RISC_SERVICE_ACCOUNT_EMAIL && raw.GOOGLE_RISC_PRIVATE_KEY;

    // If ADC is disabled, require explicit credentials
    if (disableAdc && !hasExplicitCredentials) {
      throw new Error(
        'RISC is configured with GOOGLE_RISC_DISABLE_ADC=true but missing ' +
          'GOOGLE_RISC_SERVICE_ACCOUNT_EMAIL and/or GOOGLE_RISC_PRIVATE_KEY',
      );
    }

    env.riscConfig = {
      webhookUrl: raw.RISC_WEBHOOK_URL,
      useAdc: !disableAdc,
      serviceAccountEmail: raw.GOOGLE_RISC_SERVICE_ACCOUNT_EMAIL,
      privateKey: raw.GOOGLE_RISC_PRIVATE_KEY,
    };
  }

  return env;
}

/**
 * Validated environment variables.
 * Use the computed config objects (e.g., `env.googleCalendar`) for service configuration.
 * These objects are only present when all required environment variables are set.
 * Partial configurations throw an error at startup.
 */
export const env: Env = getEnv();
