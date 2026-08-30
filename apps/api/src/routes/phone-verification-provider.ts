/**
 * Provider boundary for proving control of a linked phone number.
 *
 * Twilio owns code generation and comparison in production. Docket stores only the provider
 * challenge identifier and its own abuse counters. The capture adapter gives local development
 * and tests the same contract without an external account.
 */

/** Provider states that affect Docket's verification state machine. */
export type PhoneVerificationProviderStatus = 'pending' | 'approved' | 'failed';

/** Provider-owned result from starting or checking one verification. */
export interface PhoneVerificationProviderResult {
  /** Opaque provider identifier used only for support correlation. */
  readonly providerChallengeId: string;
  /** Normalized state that never exposes provider copy to the caller. */
  readonly status: PhoneVerificationProviderStatus;
}

/** Port used by the phone-verification service. */
export interface PhoneVerificationProvider {
  /** Stable storage value naming the adapter. */
  readonly kind: 'twilio_verify' | 'capture';
  /** Start an SMS verification for the normalized destination. */
  start(to: string): Promise<PhoneVerificationProviderResult>;
  /** Check a submitted code for the normalized destination. */
  check(to: string, code: string): Promise<PhoneVerificationProviderResult>;
}

/** Configuration needed by {@link TwilioVerifyProvider}. */
export interface TwilioVerifyProviderConfig {
  readonly accountSid: string;
  readonly authToken: string;
  readonly serviceSid: string;
  readonly fetch?: typeof globalThis.fetch;
}

interface TwilioVerifyResponse {
  readonly sid?: unknown;
  readonly status?: unknown;
}

/** Twilio Verify REST adapter with no SDK dependency. */
export class TwilioVerifyProvider implements PhoneVerificationProvider {
  readonly kind = 'twilio_verify' as const;
  private readonly request: typeof globalThis.fetch;

  constructor(private readonly config: TwilioVerifyProviderConfig) {
    this.request = config.fetch ?? globalThis.fetch;
  }

  /** Start an SMS verification through the configured Verify service. */
  async start(to: string): Promise<PhoneVerificationProviderResult> {
    return await this.post('Verifications', { To: to, Channel: 'sms' });
  }

  /** Check a code through the configured Verify service. */
  async check(to: string, code: string): Promise<PhoneVerificationProviderResult> {
    return await this.post('VerificationCheck', { To: to, Code: code });
  }

  private async post(
    resource: 'Verifications' | 'VerificationCheck',
    fields: Readonly<Record<string, string>>,
  ): Promise<PhoneVerificationProviderResult> {
    const response = await this.request(
      `https://verify.twilio.com/v2/Services/${encodeURIComponent(this.config.serviceSid)}/${resource}`,
      {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString('base64')}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(fields),
      },
    );
    if (!response.ok) throw new Error('phone verification provider unavailable');
    const payload = (await response.json()) as TwilioVerifyResponse;
    if (typeof payload.sid !== 'string' || typeof payload.status !== 'string') {
      throw new Error('phone verification provider returned an invalid response');
    }
    return {
      providerChallengeId: payload.sid,
      status: normalizeTwilioStatus(payload.status),
    };
  }
}

/** In-memory provider for tests and local development. */
export class CapturePhoneVerificationProvider implements PhoneVerificationProvider {
  readonly kind = 'capture' as const;
  /** Destinations and codes that would have been sent. */
  readonly outbox: { readonly to: string; readonly code: string }[] = [];
  private readonly active = new Map<string, { readonly id: string; readonly code: string }>();
  private sequence = 0;

  constructor(private readonly code = '123456') {}

  /** Capture a verification without contacting a provider. */
  async start(to: string): Promise<PhoneVerificationProviderResult> {
    const id = `capture-verification-${String(++this.sequence)}`;
    this.active.set(to, { id, code: this.code });
    this.outbox.push({ to, code: this.code });
    return { providerChallengeId: id, status: 'pending' };
  }

  /** Approve only the latest captured code for the destination. */
  async check(to: string, code: string): Promise<PhoneVerificationProviderResult> {
    const active = this.active.get(to);
    if (!active) return { providerChallengeId: 'capture-missing', status: 'failed' };
    if (active.code !== code) return { providerChallengeId: active.id, status: 'pending' };
    this.active.delete(to);
    return { providerChallengeId: active.id, status: 'approved' };
  }
}

function normalizeTwilioStatus(status: string): PhoneVerificationProviderStatus {
  if (status === 'approved') return 'approved';
  if (status === 'pending') return 'pending';
  return 'failed';
}
