/**
 * `@docket/mail` — environment-driven selection of the inbound-mail adapter.
 *
 * @remarks
 * The receiving mirror of {@link buildMailerFromEnv}, and it fails closed where sending fails
 * open. A misconfigured *sender* delays a notification; a misconfigured *receiver* would either
 * lose mail or — far worse — accept unsigned posts from anyone who learns the URL. So production
 * requires both the API key and the webhook signing secret and refuses to boot without them,
 * rather than degrading to something that still returns `200`.
 */
import { realEnvValue } from '@docket/env';

import { FixtureInboundReceiver } from './fixture-inbound';
import type { InboundMailReceiver } from './inbound';
import { ResendInboundReceiver } from './resend-inbound';

/** Runtime values used to select Docket's inbound-mail adapter. */
export interface InboundMailEnv {
  /** Runtime mode. `local`/`test` always use the offline fixture adapter. */
  readonly APP_MODE: 'local' | 'test' | 'production';
  /** Resend API key — production reads message bodies from the receiving API with it. */
  readonly RESEND_API_KEY?: string;
  /** The `whsec_…` signing secret for the inbound webhook endpoint. */
  readonly RESEND_INBOUND_WEBHOOK_SECRET?: string;
  /** Receiving API base override (tests / a provider-side migration). */
  readonly RESEND_RECEIVING_API_BASE?: string;
}

/**
 * Build the inbound-mail receiver for a runtime environment.
 *
 * @remarks
 * Local and test always get {@link FixtureInboundReceiver}, so the whole delivery path — webhook
 * to stored context object to Athena's stream — runs with no provider account and no DNS. When a
 * local stack *does* configure a signing secret, the fixture adapter verifies it with the real
 * algorithm, so signing can be exercised before production is ever touched.
 *
 * @param env - Inbound-mail runtime environment values.
 * @returns the selected inbound receiver.
 * @throws {Error} When production is missing `RESEND_API_KEY` or `RESEND_INBOUND_WEBHOOK_SECRET`.
 */
export function buildInboundReceiverFromEnv(env: InboundMailEnv): InboundMailReceiver {
  const signingSecret = realEnvValue(env.RESEND_INBOUND_WEBHOOK_SECRET);

  if (env.APP_MODE === 'local' || env.APP_MODE === 'test') {
    return new FixtureInboundReceiver(signingSecret ? { signingSecret } : {});
  }

  const apiKey = realEnvValue(env.RESEND_API_KEY);
  if (!apiKey || !signingSecret) {
    throw new Error(
      'Missing required production inbound mail config: RESEND_API_KEY and RESEND_INBOUND_WEBHOOK_SECRET',
    );
  }
  const apiBase = realEnvValue(env.RESEND_RECEIVING_API_BASE);
  return new ResendInboundReceiver({
    signingSecret,
    apiKey,
    ...(apiBase ? { apiBase } : {}),
  });
}
