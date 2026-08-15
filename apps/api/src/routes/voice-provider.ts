/**
 * `@docket/api` — the realtime speech seam, with a real adapter and a fixture-backed double.
 *
 * @remarks
 * ## Why a browser gets a credential rather than a socket to us
 *
 * The production browser path is **WebRTC straight from the browser to the speech model**, using
 * an ephemeral client secret this module mints. Docket is not in the audio path at all. That is a
 * latency decision before it is an architecture decision: a duplex conversation dies at a few
 * hundred milliseconds of added round trip, and proxying Opus frames through a Cloud Run instance
 * in another region spends that budget on nothing. Docket stays in the *control* path — the
 * transcripts, the tool calls, the persistence — which is where its authority actually is.
 *
 * The credential is ephemeral (minutes, minted per session) and is **not** Docket's provider key.
 * The provider key never leaves the server, and a stolen client secret expires before it is worth
 * anything.
 *
 * ## Why the mock is a first-class adapter
 *
 * The whole voice and phone stack has to be runnable and testable with zero external accounts, so
 * {@link MockRealtimeProvider} is not a stub that throws — it mints a fixture credential the web
 * client recognizes and drives a deterministic script through the *same* engine the real provider
 * feeds. Local development exercises the real turn-taking, the real persistence, and the real tool
 * dispatch; only the audio is simulated.
 *
 * ## The phone channel has no adapter here
 *
 * Twilio ConversationRelay performs speech-to-text and text-to-speech itself and speaks JSON over
 * a WebSocket, so the telephone's "speech provider" is the transport. It is named
 * {@link TWILIO_RELAY_PROVIDER_ID} on the session row for support diagnostics and appears nowhere
 * else — see `twilio-voice.ts`.
 */
import type { VoiceProviderCredential } from '@docket/athena/voice';

import type { VoiceToolDefinition } from './voice-engine';

/** Which realtime speech backend a session is running on. */
export type VoiceProviderId = 'openai-realtime' | 'twilio-relay' | 'mock';

/** The provider id recorded on a phone session. */
export const TWILIO_RELAY_PROVIDER_ID: VoiceProviderId = 'twilio-relay';

/** What a browser session needs minted for it. */
export interface IssueClientSessionInput {
  /** The system prompt the realtime model opens with, including recent conversation. */
  readonly instructions: string;
  /** The tools the model may call mid-utterance. */
  readonly tools: readonly VoiceToolDefinition[];
  /** The line Athena opens with. */
  readonly greeting: string;
}

/** The realtime speech port. */
export interface VoiceRealtimeProvider {
  readonly id: VoiceProviderId;
  /**
   * Mint a short-lived credential for a browser to open its own audio link.
   *
   * @param input - The instructions, tools and greeting the session starts with.
   * @returns the credential the browser uses; never Docket's own provider key.
   */
  issueClientSession(input: IssueClientSessionInput): Promise<VoiceProviderCredential>;
}

/** The subset of the environment this seam reads. */
export interface VoiceProviderEnv {
  readonly APP_MODE?: string | undefined;
  readonly OPENAI_API_KEY?: string | undefined;
  readonly VOICE_REALTIME_MODEL?: string | undefined;
  readonly VOICE_REALTIME_VOICE?: string | undefined;
}

/** The realtime model used when the environment does not name one. */
export const DEFAULT_REALTIME_MODEL = 'gpt-realtime';
/** The synthesized voice used when the environment does not name one. */
export const DEFAULT_REALTIME_VOICE = 'marin';
/** How long a minted client secret stays usable. */
export const CLIENT_SECRET_TTL_SECONDS = 600;

/** OpenAI's ephemeral-credential endpoint (`POST /v1/realtime/client_secrets`). */
const OPENAI_CLIENT_SECRETS_URL = 'https://api.openai.com/v1/realtime/client_secrets';
/** The endpoint a browser posts its SDP offer to. */
const OPENAI_CALLS_URL = 'https://api.openai.com/v1/realtime/calls';

/** The GA response shape of `POST /v1/realtime/client_secrets`. */
interface ClientSecretResponse {
  readonly value?: unknown;
  readonly expires_at?: unknown;
}

/**
 * Whether this process should use test doubles rather than real provider accounts.
 *
 * @param env - The runtime environment slice.
 */
export function voiceLocalMode(env: VoiceProviderEnv): boolean {
  return env.APP_MODE === 'local' || env.APP_MODE === 'test';
}

/**
 * The real adapter: mints an OpenAI Realtime ephemeral client secret.
 *
 * @remarks
 * The session configuration — model, voice, instructions, tools, server-side turn detection — is
 * pinned into the credential at mint time, so the browser cannot widen its own capabilities by
 * editing what it sends. Server VAD is what makes barge-in work without a push-to-talk button:
 * the provider stops generating the moment it detects speech, which is the only place in the
 * chain fast enough to do it.
 */
export class OpenAiRealtimeProvider implements VoiceRealtimeProvider {
  /** This adapter's id. */
  readonly id: VoiceProviderId = 'openai-realtime';

  constructor(
    private readonly apiKey: string,
    private readonly model: string = DEFAULT_REALTIME_MODEL,
    private readonly voice: string = DEFAULT_REALTIME_VOICE,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** Mint the ephemeral credential. */
  async issueClientSession(input: IssueClientSessionInput): Promise<VoiceProviderCredential> {
    const response = await this.fetchImpl(OPENAI_CLIENT_SECRETS_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        expires_after: { anchor: 'created_at', seconds: CLIENT_SECRET_TTL_SECONDS },
        session: {
          type: 'realtime',
          model: this.model,
          instructions: input.instructions,
          audio: {
            input: {
              // Server-side voice activity detection. This is the barge-in mechanism: the
              // provider halts its own output the instant it hears speech, with no client round
              // trip and no button.
              turn_detection: { type: 'server_vad', interrupt_response: true },
              transcription: { model: 'gpt-4o-mini-transcribe' },
            },
            output: { voice: this.voice },
          },
          tools: input.tools.map((tool) => ({
            type: 'function',
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          })),
        },
      }),
    });

    if (!response.ok) {
      // The provider's body is never surfaced or logged verbatim — the caller turns this into
      // application-owned copy. The status is kept because it is a stable machine signal.
      throw new VoiceProviderUnavailableError(response.status);
    }

    const payload = (await response.json()) as ClientSecretResponse;
    const value = typeof payload.value === 'string' ? payload.value : '';
    if (!value) throw new VoiceProviderUnavailableError(response.status);
    const expiresAt =
      typeof payload.expires_at === 'number'
        ? new Date(payload.expires_at * 1000)
        : new Date(Date.now() + CLIENT_SECRET_TTL_SECONDS * 1000);

    return {
      transport: 'webrtc',
      provider: this.id,
      model: this.model,
      url: OPENAI_CALLS_URL,
      clientSecret: value,
      expiresAt: expiresAt.toISOString(),
    };
  }
}

/**
 * The fixture-backed double used in local and test mode.
 *
 * @remarks
 * Returns a credential whose `transport` is `mock`, which the web client reads as "do not open a
 * peer connection; run the local script instead". The secret is a visibly fake, non-bearer string
 * so it cannot be mistaken for a live credential in a log or a screenshot.
 */
export class MockRealtimeProvider implements VoiceRealtimeProvider {
  /** This adapter's id. */
  readonly id: VoiceProviderId = 'mock';

  constructor(private readonly now: () => Date = () => new Date()) {}

  /** Mint the fixture credential. */
  issueClientSession(_input: IssueClientSessionInput): Promise<VoiceProviderCredential> {
    return Promise.resolve({
      transport: 'mock',
      provider: this.id,
      model: 'fixture-realtime',
      url: '',
      clientSecret: 'mock-no-credential-required',
      expiresAt: new Date(this.now().getTime() + CLIENT_SECRET_TTL_SECONDS * 1000).toISOString(),
    });
  }
}

/**
 * The realtime provider is not answering.
 *
 * @remarks
 * Carries the HTTP status as a stable machine code and nothing else. The provider's own error
 * text is deliberately dropped at this boundary rather than carried and later accidentally
 * rendered.
 */
export class VoiceProviderUnavailableError extends Error {
  constructor(readonly status: number) {
    super(`realtime provider responded ${String(status)}`);
    this.name = 'VoiceProviderUnavailableError';
  }
}

/**
 * Choose the realtime provider for this process.
 *
 * @remarks
 * Local and test always use the double even if a real key happens to be present, matching how
 * every other boundary in Docket resolves — a developer's stray key must never turn a test run
 * into a billed call.
 *
 * @param env - The runtime environment slice.
 * @param fetchImpl - Injected fetch, for tests.
 * @returns the provider this process should use.
 * @throws {Error} In production when no realtime credential is configured.
 */
export function resolveVoiceProvider(
  env: VoiceProviderEnv,
  fetchImpl: typeof fetch = fetch,
): VoiceRealtimeProvider {
  if (voiceLocalMode(env)) return new MockRealtimeProvider();
  const key = env.OPENAI_API_KEY;
  if (!key) {
    throw new Error('Missing required production voice config: OPENAI_API_KEY');
  }
  return new OpenAiRealtimeProvider(
    key,
    env.VOICE_REALTIME_MODEL ?? DEFAULT_REALTIME_MODEL,
    env.VOICE_REALTIME_VOICE ?? DEFAULT_REALTIME_VOICE,
    fetchImpl,
  );
}
