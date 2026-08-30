/** Outbound telephony boundary for verified callbacks and active-call revocation. */
import { randomUUID } from 'node:crypto';

/** Input for one callback placed only to a stored verified number. */
export interface PlaceCallbackInput {
  readonly to: string;
  readonly answerUrl: string;
  readonly statusCallbackUrl: string;
}

/** Provider operations used by the phone authorization and revocation services. */
export interface TelephonyProvider {
  /** Place one outbound callback and return its provider call identifier. */
  placeCallback(input: PlaceCallbackInput): Promise<string>;
  /** End an active provider call. */
  endCall(callSid: string): Promise<void>;
}

/** Configuration for {@link TwilioTelephony}. */
export interface TwilioTelephonyConfig {
  readonly accountSid: string;
  readonly authToken: string;
  readonly from: string;
  readonly fetch?: typeof globalThis.fetch;
}

/** Twilio Calls REST adapter with no SDK dependency. */
export class TwilioTelephony implements TelephonyProvider {
  private readonly request: typeof globalThis.fetch;

  constructor(private readonly config: TwilioTelephonyConfig) {
    this.request = config.fetch ?? globalThis.fetch;
  }

  /** Place a callback from the Docket-owned number. */
  async placeCallback(input: PlaceCallbackInput): Promise<string> {
    const response = await this.post('Calls.json', {
      To: input.to,
      From: this.config.from,
      Url: input.answerUrl,
      Method: 'POST',
      StatusCallback: input.statusCallbackUrl,
      StatusCallbackMethod: 'POST',
      StatusCallbackEvent: 'initiated ringing answered completed',
    });
    const payload = (await response.json()) as { sid?: unknown };
    if (typeof payload.sid !== 'string') throw new Error('telephony provider returned no call id');
    return payload.sid;
  }

  /** Tell Twilio to complete an active call. */
  async endCall(callSid: string): Promise<void> {
    await this.post(`Calls/${encodeURIComponent(callSid)}.json`, { Status: 'completed' });
  }

  private async post(
    resource: string,
    fields: Readonly<Record<string, string>>,
  ): Promise<Response> {
    const response = await this.request(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.config.accountSid)}/${resource}`,
      {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString('base64')}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(fields),
      },
    );
    if (!response.ok) throw new Error('telephony provider unavailable');
    return response;
  }
}

/** Offline telephony adapter for tests and local development. */
export class CaptureTelephonyProvider implements TelephonyProvider {
  readonly callbacks: PlaceCallbackInput[] = [];
  readonly placedCallSids: string[] = [];
  readonly endedCallSids: string[] = [];
  private readonly callPrefix = randomUUID().replace(/-/g, '');

  /** Capture one callback request. */
  async placeCallback(input: PlaceCallbackInput): Promise<string> {
    this.callbacks.push(input);
    const callSid = `CA_capture_${this.callPrefix}_${String(this.callbacks.length)}`;
    this.placedCallSids.push(callSid);
    return callSid;
  }

  /** Capture one call termination. */
  async endCall(callSid: string): Promise<void> {
    this.endedCallSids.push(callSid);
  }
}
