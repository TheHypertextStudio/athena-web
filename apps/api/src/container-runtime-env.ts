/** Runtime-environment projection for the API dependency container. */
import { env } from './env';

import type { AppRuntimeEnv } from './container';

function billingRuntimeEnv(): Partial<AppRuntimeEnv> {
  return {
    BILLING_ENABLED: env.BILLING_ENABLED,
    ...(env.BILLING_CANARY_EMAILS ? { BILLING_CANARY_EMAILS: env.BILLING_CANARY_EMAILS } : {}),
    ...(env.STRIPE_SECRET_KEY ? { STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY } : {}),
    ...(env.STRIPE_HYPERTEXT_STUDIO_ACCOUNT_ID
      ? { STRIPE_HYPERTEXT_STUDIO_ACCOUNT_ID: env.STRIPE_HYPERTEXT_STUDIO_ACCOUNT_ID }
      : {}),
    ...(env.STRIPE_WEBHOOK_SECRET ? { STRIPE_WEBHOOK_SECRET: env.STRIPE_WEBHOOK_SECRET } : {}),
    ...(env.STRIPE_PRICE_DOCKET_PRO
      ? { STRIPE_PRICE_DOCKET_PRO: env.STRIPE_PRICE_DOCKET_PRO }
      : {}),
    ...(env.DOCKET_PRICE_LOOKUP_DOCKET_PRO
      ? { DOCKET_PRICE_LOOKUP_DOCKET_PRO: env.DOCKET_PRICE_LOOKUP_DOCKET_PRO }
      : {}),
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- One-release compatibility for the former Docket Team configuration.
    ...(env.STRIPE_PRICE_TEAM ? { STRIPE_PRICE_TEAM: env.STRIPE_PRICE_TEAM } : {}),
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- One-release compatibility for the former Docket Team configuration.
    ...(env.DOCKET_PRICE_LOOKUP_TEAM
      ? // eslint-disable-next-line @typescript-eslint/no-deprecated -- One-release compatibility for the former Docket Team configuration.
        { DOCKET_PRICE_LOOKUP_TEAM: env.DOCKET_PRICE_LOOKUP_TEAM }
      : {}),
    ...(env.STRIPE_BILLING_PORTAL_CONFIG_ID
      ? { STRIPE_BILLING_PORTAL_CONFIG_ID: env.STRIPE_BILLING_PORTAL_CONFIG_ID }
      : {}),
    ...(env.STRIPE_SINGLE_SUBSCRIPTION_REDIRECT_VERIFIED_AT
      ? {
          STRIPE_SINGLE_SUBSCRIPTION_REDIRECT_VERIFIED_AT:
            env.STRIPE_SINGLE_SUBSCRIPTION_REDIRECT_VERIFIED_AT,
        }
      : {}),
  };
}

function agentRuntimeEnv(): Partial<AppRuntimeEnv> {
  return {
    ...(env.ANTHROPIC_API_KEY ? { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY } : {}),
    ...(env.CLOUDFLARE_AI_GATEWAY_BASE_URL
      ? { CLOUDFLARE_AI_GATEWAY_BASE_URL: env.CLOUDFLARE_AI_GATEWAY_BASE_URL }
      : {}),
    ...(env.CLOUDFLARE_AI_GATEWAY_TOKEN
      ? { CLOUDFLARE_AI_GATEWAY_TOKEN: env.CLOUDFLARE_AI_GATEWAY_TOKEN }
      : {}),
    ...(env.OPENAI_API_KEY ? { OPENAI_API_KEY: env.OPENAI_API_KEY } : {}),
  };
}

function mailRuntimeEnv(): Partial<AppRuntimeEnv> {
  return {
    ...(env.RESEND_API_KEY ? { RESEND_API_KEY: env.RESEND_API_KEY } : {}),
    ...(env.RESEND_INBOUND_WEBHOOK_SECRET
      ? { RESEND_INBOUND_WEBHOOK_SECRET: env.RESEND_INBOUND_WEBHOOK_SECRET }
      : {}),
    ...(env.RESEND_RECEIVING_API_BASE
      ? { RESEND_RECEIVING_API_BASE: env.RESEND_RECEIVING_API_BASE }
      : {}),
    ...(env.SMTP_HOST ? { SMTP_HOST: env.SMTP_HOST } : {}),
    ...(env.SMTP_PORT ? { SMTP_PORT: env.SMTP_PORT } : {}),
    ...(env.SMTP_SECURE ? { SMTP_SECURE: env.SMTP_SECURE } : {}),
    ...(env.SMTP_USER ? { SMTP_USER: env.SMTP_USER } : {}),
    ...(env.SMTP_PASS ? { SMTP_PASS: env.SMTP_PASS } : {}),
    ...(env.MAIL_FROM ? { MAIL_FROM: env.MAIL_FROM } : {}),
  };
}

function notificationRuntimeEnv(): Partial<AppRuntimeEnv> {
  return {
    ...(env.SMS_ENDPOINT ? { SMS_ENDPOINT: env.SMS_ENDPOINT } : {}),
    ...(env.SMS_API_KEY ? { SMS_API_KEY: env.SMS_API_KEY } : {}),
    ...(env.SMS_FROM ? { SMS_FROM: env.SMS_FROM } : {}),
    ...(env.PUSH_ENDPOINT ? { PUSH_ENDPOINT: env.PUSH_ENDPOINT } : {}),
    ...(env.PUSH_API_KEY ? { PUSH_API_KEY: env.PUSH_API_KEY } : {}),
    ...(env.PUSH_APP_ID ? { PUSH_APP_ID: env.PUSH_APP_ID } : {}),
  };
}

function telephonyRuntimeEnv(): Partial<AppRuntimeEnv> {
  return {
    ...(env.VOICE_REALTIME_MODEL ? { VOICE_REALTIME_MODEL: env.VOICE_REALTIME_MODEL } : {}),
    ...(env.VOICE_REALTIME_VOICE ? { VOICE_REALTIME_VOICE: env.VOICE_REALTIME_VOICE } : {}),
    ...(env.TWILIO_ACCOUNT_SID ? { TWILIO_ACCOUNT_SID: env.TWILIO_ACCOUNT_SID } : {}),
    ...(env.TWILIO_AUTH_TOKEN ? { TWILIO_AUTH_TOKEN: env.TWILIO_AUTH_TOKEN } : {}),
    ...(env.TWILIO_PHONE_NUMBER ? { TWILIO_PHONE_NUMBER: env.TWILIO_PHONE_NUMBER } : {}),
    ...(env.TWILIO_VERIFY_API_KEY_SID
      ? { TWILIO_VERIFY_API_KEY_SID: env.TWILIO_VERIFY_API_KEY_SID }
      : {}),
    ...(env.TWILIO_VERIFY_API_KEY_SECRET
      ? { TWILIO_VERIFY_API_KEY_SECRET: env.TWILIO_VERIFY_API_KEY_SECRET }
      : {}),
    ...(env.TWILIO_VERIFY_SERVICE_SID
      ? { TWILIO_VERIFY_SERVICE_SID: env.TWILIO_VERIFY_SERVICE_SID }
      : {}),
  };
}

function integrationRuntimeEnv(): Partial<AppRuntimeEnv> {
  return {
    ...(env.LINEAR_WEBHOOK_SECRET ? { LINEAR_WEBHOOK_SECRET: env.LINEAR_WEBHOOK_SECRET } : {}),
    ...(env.GITHUB_APP_WEBHOOK_SECRET
      ? { GITHUB_APP_WEBHOOK_SECRET: env.GITHUB_APP_WEBHOOK_SECRET }
      : {}),
    ...(env.GITHUB_API_BASE ? { GITHUB_API_BASE: env.GITHUB_API_BASE } : {}),
    ...(env.LINEAR_API_BASE ? { LINEAR_API_BASE: env.LINEAR_API_BASE } : {}),
    ...(env.GOOGLE_GMAIL_API_BASE ? { GOOGLE_GMAIL_API_BASE: env.GOOGLE_GMAIL_API_BASE } : {}),
    ...(env.GOOGLE_CALENDAR_API_BASE
      ? { GOOGLE_CALENDAR_API_BASE: env.GOOGLE_CALENDAR_API_BASE }
      : {}),
    ...(env.GOOGLE_TASKS_API_BASE ? { GOOGLE_TASKS_API_BASE: env.GOOGLE_TASKS_API_BASE } : {}),
  };
}

/** Build the container runtime configuration from the validated API environment. */
export function toAppRuntimeEnv(): AppRuntimeEnv {
  return {
    APP_MODE: env.APP_MODE,
    PHONE_VERIFICATION_ENABLED: env.PHONE_VERIFICATION_ENABLED,
    ...(env.PHONE_VERIFICATION_CANARY_EMAILS
      ? { PHONE_VERIFICATION_CANARY_EMAILS: env.PHONE_VERIFICATION_CANARY_EMAILS }
      : {}),
    ...billingRuntimeEnv(),
    ...agentRuntimeEnv(),
    ...mailRuntimeEnv(),
    ...notificationRuntimeEnv(),
    ...telephonyRuntimeEnv(),
    ...integrationRuntimeEnv(),
    ...(env.BLOB_READ_WRITE_TOKEN ? { BLOB_READ_WRITE_TOKEN: env.BLOB_READ_WRITE_TOKEN } : {}),
    ...(env.EXPORT_BUCKET_URL ? { EXPORT_BUCKET_URL: env.EXPORT_BUCKET_URL } : {}),
    ...(env.MAPBOX_ACCESS_TOKEN ? { MAPBOX_ACCESS_TOKEN: env.MAPBOX_ACCESS_TOKEN } : {}),
  };
}
