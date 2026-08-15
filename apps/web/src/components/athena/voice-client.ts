/**
 * The browser half of Athena's voice mode: microphone, audio link, and the event relay.
 *
 * @remarks
 * ## What runs where
 *
 * The audio link is **browser to speech model, directly**, over WebRTC using a short-lived
 * credential the API mints. Docket is not in the audio path, so it adds nothing to the latency
 * budget that decides whether a conversation feels alive. What the browser sends to Docket is the
 * *events* — transcripts, speech boundaries, tool calls, barge-ins — which the server feeds into
 * the one shared voice session engine. Every decision with authority behind it stays on the
 * server; the browser only carries sound.
 *
 * ## Barge-in has no button
 *
 * Server-side voice activity detection lives in the speech provider's session configuration
 * (`turn_detection: server_vad` with `interrupt_response`), so the model stops generating the
 * instant it hears speech — no client round trip, no push-to-talk. This module's job on
 * interruption is only to report *how much was actually heard* so the transcript records the
 * conversation that happened rather than the one that was planned.
 *
 * ## The fixture transport
 *
 * When the API mints a `mock` credential (local development and tests, with no provider account
 * configured) the same {@link VoiceClient} runs a deterministic script through the same relay.
 * The microphone is still opened for real — the live input meter is reading genuine microphone
 * energy either way — but nothing is transmitted anywhere.
 */
import type {
  VoiceInboundEvent,
  VoiceOutboundCommand,
  VoiceProviderCredential,
  VoiceSessionState,
  VoiceTurnOut,
} from '@docket/athena/voice';

/** How often the input meter samples microphone energy. */
const METER_INTERVAL_MS = 80;

/** How the client reports itself to the surface. */
export interface VoiceClientEvents {
  /** The session state changed. */
  onState(state: VoiceSessionState): void;
  /** New persisted turns arrived from the engine. */
  onTurns(turns: readonly VoiceTurnOut[]): void;
  /** Normalized microphone energy, 0–1, sampled continuously while listening. */
  onLevel(level: number): void;
  /** Something the person needs to be told, in application-owned words. */
  onNotice(message: string): void;
}

/** Why a voice session could not start, as a stable code the surface writes copy for. */
export type VoiceStartRefusal =
  | 'microphone-denied'
  | 'microphone-missing'
  | 'audio-unsupported'
  | 'link-failed';

/** A voice session start attempt that did not succeed. */
export class VoiceStartError extends Error {
  constructor(readonly refusal: VoiceStartRefusal) {
    super(refusal);
    this.name = 'VoiceStartError';
  }
}

/** How the client reaches the API to relay events. */
export interface VoiceRelay {
  /**
   * Push transport events into the session engine.
   *
   * @param events - The events, oldest first.
   * @returns the engine's resulting state, commands and persisted turns.
   */
  send(events: readonly VoiceInboundEvent[]): Promise<{
    readonly state: VoiceSessionState;
    readonly commands: readonly VoiceOutboundCommand[];
    readonly turns: readonly VoiceTurnOut[];
  }>;
}

/**
 * Ask for the microphone.
 *
 * @remarks
 * Split out so the surface can distinguish "you said no" from "there is no microphone" from "this
 * browser cannot do audio at all" — three refusals that need three different sentences, and which
 * an exception message would collapse into one unreadable string.
 *
 * @returns the live microphone stream.
 * @throws {VoiceStartError} With the refusal code the surface writes copy for.
 */
export async function requestMicrophone(): Promise<MediaStream> {
  // `navigator.mediaDevices` is typed as always present but is genuinely absent on an insecure
  // origin, which is exactly the case this branch exists for.
  const devices = (navigator as { mediaDevices?: MediaDevices }).mediaDevices;
  if (!devices) throw new VoiceStartError('audio-unsupported');
  try {
    return await devices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (caught) {
    const name = caught instanceof DOMException ? caught.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw new VoiceStartError('microphone-denied');
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      throw new VoiceStartError('microphone-missing');
    }
    throw new VoiceStartError('audio-unsupported');
  }
}

/**
 * A live browser voice session.
 *
 * @remarks
 * Owns the microphone, the input meter, the peer connection (when there is one), and the relay
 * loop. Constructed by the surface after the API has minted a credential; `stop()` releases
 * everything, including the microphone indicator in the browser chrome, which is the one piece of
 * cleanup a person notices immediately if it is missed.
 */
export class VoiceClient {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private meterTimer: ReturnType<typeof setInterval> | null = null;
  private peer: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private stopped = false;

  constructor(
    private readonly stream: MediaStream,
    private readonly credential: VoiceProviderCredential,
    private readonly relay: VoiceRelay,
    private readonly events: VoiceClientEvents,
  ) {}

  /**
   * Open the audio link and start reporting.
   *
   * @throws {VoiceStartError} When the audio link cannot be established.
   */
  async start(): Promise<void> {
    this.startMeter();
    if (this.credential.transport === 'mock') {
      this.playFixture();
      return;
    }
    await this.openPeerConnection();
  }

  /** Release the microphone, the meter, and the audio link. */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.meterTimer) clearInterval(this.meterTimer);
    this.meterTimer = null;
    this.channel?.close();
    this.peer?.close();
    void this.audioContext?.close();
    for (const track of this.stream.getTracks()) track.stop();
  }

  /**
   * Relay one batch of events and apply whatever the engine says to do.
   *
   * @param events - Transport events, oldest first.
   */
  async report(events: readonly VoiceInboundEvent[]): Promise<void> {
    if (this.stopped) return;
    const step = await this.relay.send(events);
    this.events.onState(step.state);
    if (step.turns.length > 0) this.events.onTurns(step.turns);
    for (const command of step.commands) this.apply(command);
  }

  /**
   * Replay {@link FIXTURE_EXCHANGE} through the real relay.
   *
   * @remarks
   * Scheduled rather than awaited so `start()` returns and the panel reaches `listening` first,
   * which is what a person would see: the microphone opens, and then they speak.
   */
  private playFixture(): void {
    for (const step of FIXTURE_EXCHANGE) {
      setTimeout(() => {
        void this.report([step.event]);
      }, step.delayMs);
    }
  }

  private apply(command: VoiceOutboundCommand): void {
    if (command.type === 'stop.audio') {
      // The provider's own voice-activity detection already halted playback; this is the belt to
      // that braces, and the only place the client acts on a barge-in.
      this.channel?.send(JSON.stringify({ type: 'response.cancel' }));
    }
    if (command.type === 'tool.result') {
      this.channel?.send(
        JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: command.callId,
            output: command.output,
          },
        }),
      );
      this.channel?.send(JSON.stringify({ type: 'response.create' }));
    }
  }

  /**
   * Sample microphone energy for the live input indicator.
   *
   * @remarks
   * Reads the real waveform rather than animating on a timer. The distinction matters: an
   * indicator that moves whether or not the microphone is working tells a person nothing, and the
   * first thing anybody does in a voice mode is check that it is hearing them.
   */
  private startMeter(): void {
    // Safari still exposes only the prefixed constructor.
    const AudioContextCtor: typeof AudioContext | undefined =
      (window as { AudioContext?: typeof AudioContext }).AudioContext ??
      (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    const context = new AudioContextCtor();
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    context.createMediaStreamSource(this.stream).connect(analyser);
    this.audioContext = context;
    this.analyser = analyser;

    const samples = new Uint8Array(analyser.frequencyBinCount);
    this.meterTimer = setInterval(() => {
      if (!this.analyser) return;
      this.analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) {
        const centered = (sample - 128) / 128;
        sum += centered * centered;
      }
      const rms = Math.sqrt(sum / samples.length);
      // A voice at conversational volume sits near 0.1 RMS; scaling by 4 puts it mid-meter.
      this.events.onLevel(Math.min(1, rms * 4));
    }, METER_INTERVAL_MS);
  }

  private async openPeerConnection(): Promise<void> {
    const peer = new RTCPeerConnection();
    this.peer = peer;
    for (const track of this.stream.getAudioTracks()) peer.addTrack(track, this.stream);

    const audio = new Audio();
    audio.autoplay = true;
    peer.ontrack = (event) => {
      const [remote] = event.streams;
      if (remote) audio.srcObject = remote;
    };

    const channel = peer.createDataChannel('oai-events');
    this.channel = channel;
    channel.onmessage = (event: MessageEvent<string>) => {
      void this.onProviderEvent(event.data);
    };

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    const response = await fetch(`${this.credential.url}?model=${this.credential.model}`, {
      method: 'POST',
      body: offer.sdp ?? '',
      headers: {
        authorization: `Bearer ${this.credential.clientSecret}`,
        'content-type': 'application/sdp',
      },
    });
    if (!response.ok) throw new VoiceStartError('link-failed');
    await peer.setRemoteDescription({ type: 'answer', sdp: await response.text() });
  }

  /**
   * Translate one realtime provider event into the channel-agnostic vocabulary and relay it.
   *
   * @remarks
   * This is the browser channel's entire transport adapter — the mirror image of the Twilio bridge
   * on the server. Everything it does not recognize is dropped rather than guessed at, because a
   * provider adds event types over time and a live call is a bad place to crash on one.
   */
  private async onProviderEvent(raw: string): Promise<void> {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    const event = translateProviderEvent(payload);
    if (event) await this.report([event]);
  }
}

/**
 * Map one realtime provider server event onto a {@link VoiceInboundEvent}.
 *
 * @remarks
 * Exported so the mapping is unit-testable without a peer connection. The provider's names are the
 * GA Realtime API's: `response.output_audio.delta`, `response.output_audio_transcript.delta`,
 * `conversation.item.input_audio_transcription.completed`, `response.function_call_arguments.done`,
 * `input_audio_buffer.speech_started`, `response.done`.
 *
 * @param payload - The parsed provider event.
 * @returns the engine event, or `null` when there is nothing to report.
 */
export function translateProviderEvent(payload: Record<string, unknown>): VoiceInboundEvent | null {
  const type = typeof payload['type'] === 'string' ? payload['type'] : '';
  switch (type) {
    case 'conversation.item.input_audio_transcription.completed':
      return {
        type: 'user.transcript',
        text: str(payload['transcript']),
        final: true,
      };
    case 'conversation.item.input_audio_transcription.delta':
      return { type: 'user.transcript', text: str(payload['delta']), final: false };
    case 'response.output_audio_transcript.delta':
      return { type: 'assistant.transcript.delta', text: str(payload['delta']) };
    case 'response.output_audio.delta':
      // The first audio frame of a turn is what "Athena started speaking" means to a listener.
      return { type: 'assistant.audio.start' };
    case 'response.output_audio.done':
      return { type: 'assistant.audio.end' };
    case 'input_audio_buffer.speech_started':
      // Server VAD fired while a response was in flight: the person cut in.
      return {
        type: 'user.interrupted',
        spokenText: '',
        elapsedMs: Math.max(0, Math.trunc(numeric(payload['audio_start_ms']))),
      };
    case 'response.function_call_arguments.done':
      return {
        type: 'tool.call',
        callId: str(payload['call_id']),
        name: str(payload['name']),
        arguments: parseArguments(payload['arguments']),
      };
    default:
      return null;
  }
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numeric(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function parseArguments(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * The deterministic exchange the fixture transport plays locally.
 *
 * @remarks
 * Shaped like a real turn rather than like a demo: a partial transcript arrives first (so the
 * `listening` state is genuinely exercised), then the final one, which drives the *real* engine —
 * real persistence, real tool dispatch, real reply generation through the fixture model. Only the
 * audio is simulated. That is why local development is worth anything: everything except the
 * sound is the production path.
 */
export const FIXTURE_EXCHANGE: readonly {
  readonly delayMs: number;
  readonly event: VoiceInboundEvent;
}[] = [
  {
    delayMs: 700,
    event: { type: 'user.transcript', text: 'What should I', final: false },
  },
  {
    delayMs: 1400,
    event: { type: 'user.transcript', text: 'What should I look at first today?', final: true },
  },
];
