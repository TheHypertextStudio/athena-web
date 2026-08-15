/**
 * `@docket/api` — the one voice session engine, shared by the browser and the telephone.
 *
 * @remarks
 * **There is exactly one conversation loop for voice.** The browser and the PSTN differ only in
 * how audio moves; turn-taking, transcript persistence, tool dispatch and barge-in are decided
 * here and nowhere else. A channel adapter's entire job is to translate its provider's wire
 * messages into {@link VoiceInboundEvent} and to obey {@link VoiceOutboundCommand}. If a second
 * loop ever appears, the shape of this module is what makes that obvious rather than subtle.
 *
 * ## Why the events look like this
 *
 * The engine never receives "the assistant's reply". It receives *what is happening right now*:
 * a partial user transcript, the start of audio, a word of Athena's own words, a tool call, a
 * barge-in at 460ms. That is the difference between a live voice mode and text-to-speech attached
 * to the end of a chat completion, and it is enforced structurally — there is no event carrying a
 * finished assistant message, so no code path can wait for one.
 *
 * ## Actions run during speech, not after it
 *
 * {@link VoiceSessionEngine.receive} dispatches a `tool.call` the moment it arrives, whatever the
 * session state. There is no pending-action array on this class — deliberately, because a queue
 * is the mechanism by which "I'll do that at the end" happens by accident. The
 * {@link VoiceSessionEngine.trace} records `tool.start` and `audio.segment.end` with a monotonic
 * sequence, so "the action began before the audio it overlapped finished" is a fact a test reads
 * out of the engine rather than a claim in a comment.
 *
 * ## Barge-in is answered before it is recorded
 *
 * On `user.interrupted` the engine emits `stop.audio` as the first command, *before* it awaits any
 * write. Silence has to arrive at the person's ear at conversational latency; the database can
 * catch up afterwards. What gets persisted is the text the person actually heard
 * (`spokenText`), not what Athena intended to say, so the transcript matches the conversation
 * that really happened.
 *
 * @see {@link ../../../../docs/engineering/specs/voice-and-phone.md}
 */
import type { TurnMessage } from '@docket/athena/turn-protocol';
import type {
  VoiceActionOut,
  VoiceChannel,
  VoiceEndReason,
  VoiceInboundEvent,
  VoiceOutboundCommand,
  VoiceSessionState,
  VoiceTraceEntry,
  VoiceTurnOut,
} from '@docket/athena/voice';

/** Identity of the one session being driven. */
export interface VoiceSessionContext {
  /** The `voice_session` row. */
  readonly voiceSessionId: string;
  /** The person's single canonical Athena conversation — never a voice-only thread. */
  readonly conversationId: string;
  readonly userId: string;
  readonly organizationId: string | null;
  readonly channel: VoiceChannel;
  /** The actor Athena speaks as, when one is resolvable. */
  readonly initiatorActorId: string | null;
}

/** One tool the realtime model may call mid-utterance. */
export interface VoiceToolDefinition {
  readonly name: string;
  readonly description: string;
  /** JSON Schema for the call arguments, handed to the realtime model verbatim. */
  readonly parameters: Record<string, unknown>;
}

/** What a tool did, in words the model can speak and a person can read. */
export interface VoiceToolOutcome {
  readonly ok: boolean;
  /**
   * Application-owned sentence describing the result.
   *
   * @remarks
   * Handed straight to the model to speak and rendered on the live surface. It is never an
   * exception message or a provider string: a person hearing "ECONNREFUSED" is a product defect,
   * and a voice channel has no place to hide one.
   */
  readonly summary: string;
}

/** The port every tool the voice channel can call lives behind. */
export interface VoiceToolRunner {
  /** The tools this session offers, as the realtime model needs them declared. */
  readonly definitions: readonly VoiceToolDefinition[];
  /**
   * Execute one call.
   *
   * @param ctx - The session the call belongs to.
   * @param name - Tool name as the model called it.
   * @param args - Call arguments as the model produced them.
   */
  run(
    ctx: VoiceSessionContext,
    name: string,
    args: Record<string, unknown>,
  ): Promise<VoiceToolOutcome>;
}

/** Where spoken turns and in-flight actions are written. */
export interface VoiceTranscriptStore {
  /** Append what the person said to the canonical conversation. */
  appendUserTurn(ctx: VoiceSessionContext, text: string): Promise<VoiceTurnOut>;
  /** Append what Athena said, flagged when the person cut in. */
  appendAssistantTurn(
    ctx: VoiceSessionContext,
    text: string,
    interrupted: boolean,
  ): Promise<VoiceTurnOut>;
  /** Record an action as started, so the surface can show it while audio is still playing. */
  startAction(ctx: VoiceSessionContext, tool: string, at: Date): Promise<VoiceActionOut>;
  /** Record the same action as finished. */
  finishAction(
    ctx: VoiceSessionContext,
    action: VoiceActionOut,
    outcome: VoiceToolOutcome,
    at: Date,
  ): Promise<VoiceActionOut>;
  /** Record the session's own lifecycle counters. */
  recordSessionEnd(ctx: VoiceSessionContext, reason: VoiceEndReason, at: Date): Promise<void>;
}

/** Everything the engine needs from outside itself. */
export interface VoiceEngineDeps {
  readonly store: VoiceTranscriptStore;
  readonly tools: VoiceToolRunner;
  /**
   * Produces Athena's words on a channel whose provider has no language model.
   *
   * @remarks
   * Absent on the browser channel, where the speech-to-speech model generates in-band and its
   * output arrives as `assistant.transcript.delta` events. Present on the telephone channel,
   * where the provider only does speech-to-text and text-to-speech. See `voice-responder.ts`.
   */
  readonly responder?: VoiceResponder;
  /** Loads the conversation so far, for a channel whose reply is generated here. */
  readonly history?: () => Promise<readonly TurnMessage[]>;
  /** Injected clock; tests advance it instead of sleeping. */
  readonly now?: () => Date;
}

/** One piece of a generated reply. Mirrors `VoiceReplyChunk` in `voice-responder.ts`. */
export type VoiceReplyChunk =
  | { readonly type: 'token'; readonly text: string }
  | {
      readonly type: 'tool';
      readonly callId: string;
      readonly name: string;
      readonly arguments: Record<string, unknown>;
    }
  | { readonly type: 'done' };

/** The port that produces Athena's words on a channel with no model of its own. */
export interface VoiceResponder {
  /** Stream one reply, fragment by fragment. */
  respond(
    ctx: VoiceSessionContext,
    history: readonly TurnMessage[],
    tools: readonly VoiceToolDefinition[],
  ): AsyncIterable<VoiceReplyChunk>;
}

/** Engine output for one batch of events. */
export interface VoiceEngineStep {
  readonly state: VoiceSessionState;
  readonly commands: readonly VoiceOutboundCommand[];
  readonly turns: readonly VoiceTurnOut[];
  readonly actions: readonly VoiceActionOut[];
  readonly trace: readonly VoiceTraceEntry[];
}

/**
 * Drives one voice session, whatever channel it arrived on.
 *
 * @remarks
 * One instance per live session. It holds only what a turn genuinely needs to be in progress:
 * the current state, the assistant's words so far, and whether an audio segment is open. There is
 * no queue of deferred work, by construction.
 */
export class VoiceSessionEngine {
  private sessionState: VoiceSessionState = 'idle';
  /** Athena's words for the turn currently being spoken, accumulated from streamed deltas. */
  private assistantBuffer = '';
  /** True between `assistant.audio.start` and its matching end/interrupt. */
  private audioOpen = false;
  private seq = 0;
  private readonly traceLog: VoiceTraceEntry[] = [];
  private readonly now: () => Date;

  constructor(
    private readonly ctx: VoiceSessionContext,
    private readonly deps: VoiceEngineDeps,
  ) {
    this.now = deps.now ?? (() => new Date());
  }

  /** The state a person would name if you asked what Athena is doing. */
  get state(): VoiceSessionState {
    return this.sessionState;
  }

  /** The ordered record of what happened, newest last. */
  get trace(): readonly VoiceTraceEntry[] {
    return this.traceLog;
  }

  /** Move to `listening` and note the session has begun. */
  begin(): VoiceEngineStep {
    this.setState('listening');
    return this.step([], [], []);
  }

  /**
   * Feed one batch of transport events through the engine.
   *
   * @remarks
   * Events are applied strictly in order and each is fully handled — including its side effects —
   * before the next is read. That serialization is what makes the trace a truthful record of the
   * turn rather than a set of overlapping promises whose interleaving nobody can reason about.
   *
   * @param events - Transport events, oldest first.
   * @returns the resulting state, the commands the transport must obey, and the new trace.
   */
  async receive(events: readonly VoiceInboundEvent[]): Promise<VoiceEngineStep> {
    const commands: VoiceOutboundCommand[] = [];
    const turns: VoiceTurnOut[] = [];
    const actions: VoiceActionOut[] = [];
    const from = this.traceLog.length;

    for (const event of events) {
      await this.apply(event, commands, turns, actions);
    }
    return this.step(commands, turns, actions, from);
  }

  private async apply(
    event: VoiceInboundEvent,
    commands: VoiceOutboundCommand[],
    turns: VoiceTurnOut[],
    actions: VoiceActionOut[],
  ): Promise<void> {
    switch (event.type) {
      case 'user.transcript': {
        if (!event.final) {
          // A partial transcript means the person is mid-sentence. It is not persisted — a
          // conversation timeline made of half-words is worse than no timeline — but it does
          // establish that the floor is theirs.
          if (this.sessionState !== 'speaking') this.setState('listening');
          return;
        }
        const text = event.text.trim();
        if (!text) return;
        turns.push(await this.deps.store.appendUserTurn(this.ctx, text));
        this.record('turn.persisted', 'user');
        this.setState('thinking');
        await this.generate(commands, turns, actions);
        return;
      }

      case 'assistant.transcript.delta': {
        this.assistantBuffer += event.text;
        return;
      }

      case 'assistant.audio.start': {
        this.audioOpen = true;
        this.record('audio.segment.start', 'assistant');
        this.setState('speaking');
        return;
      }

      case 'assistant.audio.end': {
        this.record('audio.segment.end', 'assistant');
        this.audioOpen = false;
        const text = this.assistantBuffer.trim();
        this.assistantBuffer = '';
        if (text) {
          turns.push(await this.deps.store.appendAssistantTurn(this.ctx, text, false));
          this.record('turn.persisted', 'assistant');
        }
        this.setState('listening');
        return;
      }

      case 'user.interrupted': {
        // Silence first. Every await below happens after the transport already has its order.
        commands.push({ type: 'stop.audio' });
        this.record('interrupt', `after ${String(event.elapsedMs)}ms`);
        if (this.audioOpen) this.record('audio.segment.end', 'assistant (interrupted)');
        this.audioOpen = false;
        // Persist what the person actually heard, not what Athena meant to say. `spokenText` is
        // the provider's report of the audio that reached the ear; the buffered remainder is
        // discarded because it never existed as far as the conversation is concerned.
        const heard = (event.spokenText || this.assistantBuffer).trim();
        this.assistantBuffer = '';
        if (heard) {
          turns.push(await this.deps.store.appendAssistantTurn(this.ctx, heard, true));
          this.record('turn.persisted', 'assistant (interrupted)');
        }
        this.setState('listening');
        return;
      }

      case 'tool.call': {
        // Dispatched here, inline, whatever the state — including `speaking`. This is the single
        // place a voice tool call is executed, and it does not consult the audio state before
        // doing so.
        await this.dispatchTool(event.callId, event.name, event.arguments, commands, actions);
        return;
      }

      case 'dtmf': {
        // Keypad input is a transcript line like any other: it is something the person said, and
        // a session that silently ignores it looks broken to someone pressing keys.
        turns.push(await this.deps.store.appendUserTurn(this.ctx, `Pressed ${event.digit}`));
        this.record('turn.persisted', 'user (dtmf)');
        this.setState('thinking');
        await this.generate(commands, turns, actions);
        return;
      }

      case 'session.end': {
        const trailing = this.assistantBuffer.trim();
        this.assistantBuffer = '';
        if (trailing) {
          // A hang-up mid-sentence still happened; record what was said up to that point.
          turns.push(await this.deps.store.appendAssistantTurn(this.ctx, trailing, true));
          this.record('turn.persisted', 'assistant (truncated by hangup)');
        }
        this.audioOpen = false;
        await this.deps.store.recordSessionEnd(this.ctx, event.reason, this.now());
        this.setState('ended');
        commands.push({ type: 'end', reason: event.reason });
        return;
      }
    }
  }

  /**
   * Run one tool now.
   *
   * @remarks
   * The one place a voice tool executes, reached both by a provider-issued `tool.call` and by a
   * locally generated reply. It never inspects {@link VoiceSessionEngine.state} — an action does
   * not wait for the sentence around it to finish.
   */
  private async dispatchTool(
    callId: string,
    name: string,
    args: Record<string, unknown>,
    commands: VoiceOutboundCommand[],
    actions: VoiceActionOut[],
  ): Promise<VoiceToolOutcome> {
    const started = await this.deps.store.startAction(this.ctx, name, this.now());
    actions.push(started);
    this.record('tool.start', name);

    const outcome = await this.deps.tools.run(this.ctx, name, args);
    actions.push(await this.deps.store.finishAction(this.ctx, started, outcome, this.now()));
    this.record('tool.end', `${name}:${outcome.ok ? 'done' : 'failed'}`);
    commands.push({ type: 'tool.result', callId, ok: outcome.ok, output: outcome.summary });
    return outcome;
  }

  /**
   * Generate and speak a reply on a channel whose provider has no model.
   *
   * @remarks
   * No-op when no responder is configured — the browser channel's model generates in-band and
   * reports itself through `assistant.transcript.delta`.
   *
   * The loop emits each fragment as a `speak` command *as it arrives*, so the transport begins
   * synthesizing before generation has finished, and dispatches a tool the instant the model asks
   * for one — after which the tool's own sentence is spoken, so the person hears the receipt
   * inside the same turn rather than after it.
   */
  private async generate(
    commands: VoiceOutboundCommand[],
    turns: VoiceTurnOut[],
    actions: VoiceActionOut[],
  ): Promise<void> {
    const responder = this.deps.responder;
    if (!responder) return;
    const history = (await this.deps.history?.()) ?? [];

    for await (const chunk of responder.respond(this.ctx, history, this.deps.tools.definitions)) {
      if (chunk.type === 'token') {
        this.speak(chunk.text, commands);
      } else if (chunk.type === 'tool') {
        const outcome = await this.dispatchTool(
          chunk.callId,
          chunk.name,
          chunk.arguments,
          commands,
          actions,
        );
        this.speak(outcome.summary, commands);
      } else {
        commands.push({ type: 'speak', text: '', last: true, interruptible: true });
        await this.apply({ type: 'assistant.audio.end' }, commands, turns, actions);
        return;
      }
    }
  }

  /** Emit one spoken fragment, opening the audio segment on the first one. */
  private speak(text: string, commands: VoiceOutboundCommand[]): void {
    if (!text) return;
    if (!this.audioOpen) {
      this.audioOpen = true;
      this.record('audio.segment.start', 'assistant');
      this.setState('speaking');
    }
    this.assistantBuffer += this.assistantBuffer ? ` ${text}` : text;
    commands.push({ type: 'speak', text, last: false, interruptible: true });
  }

  private setState(next: VoiceSessionState): void {
    if (this.sessionState === next) return;
    this.sessionState = next;
    this.record('state', next);
  }

  private record(kind: VoiceTraceEntry['kind'], detail: string): void {
    this.seq += 1;
    this.traceLog.push({ at: this.now().toISOString(), seq: this.seq, kind, detail });
  }

  private step(
    commands: readonly VoiceOutboundCommand[],
    turns: readonly VoiceTurnOut[],
    actions: readonly VoiceActionOut[],
    from = 0,
  ): VoiceEngineStep {
    return {
      state: this.sessionState,
      commands,
      turns,
      actions,
      trace: this.traceLog.slice(from),
    };
  }
}
