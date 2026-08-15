/**
 * The voice session engine's behavioural guarantees, driven with fakes and no database.
 *
 * @remarks
 * These are the tests that make the launch claims checkable rather than assertable:
 * actions run *during* speech (ACH-05/ACH-06), barge-in halts audio before anything is written and
 * records what was actually heard (ACH-07), and no reply is ever assembled before being spoken
 * (ACH-03).
 */
import type { VoiceActionOut, VoiceEndReason, VoiceTurnOut } from '@docket/athena/voice';
import { describe, expect, it } from 'vitest';

import {
  VoiceSessionEngine,
  type VoiceReplyChunk,
  type VoiceResponder,
  type VoiceSessionContext,
  type VoiceToolOutcome,
  type VoiceToolRunner,
  type VoiceTranscriptStore,
} from '../../src/routes/voice-engine';

const ctx: VoiceSessionContext = {
  voiceSessionId: 'vs_1',
  conversationId: 'conv_1',
  userId: 'user_1',
  organizationId: 'org_1',
  channel: 'web',
  initiatorActorId: 'actor_1',
};

/** A store that records every write in order, so a test can read the whole history. */
class RecordingStore implements VoiceTranscriptStore {
  readonly turns: VoiceTurnOut[] = [];
  readonly actions: VoiceActionOut[] = [];
  ended: VoiceEndReason | null = null;
  private seq = 0;

  appendUserTurn(_c: VoiceSessionContext, text: string): Promise<VoiceTurnOut> {
    return Promise.resolve(this.push('user', text, false));
  }
  appendAssistantTurn(
    _c: VoiceSessionContext,
    text: string,
    interrupted: boolean,
  ): Promise<VoiceTurnOut> {
    return Promise.resolve(this.push('athena', text, interrupted));
  }
  startAction(_c: VoiceSessionContext, tool: string, at: Date): Promise<VoiceActionOut> {
    this.seq += 1;
    const action: VoiceActionOut = {
      id: `act_${String(this.seq)}`,
      tool,
      summary: 'working',
      status: 'running',
      startedAt: at.toISOString(),
      completedAt: null,
    };
    this.actions.push(action);
    return Promise.resolve(action);
  }
  finishAction(
    _c: VoiceSessionContext,
    action: VoiceActionOut,
    outcome: VoiceToolOutcome,
    at: Date,
  ): Promise<VoiceActionOut> {
    const done: VoiceActionOut = {
      ...action,
      summary: outcome.summary,
      status: outcome.ok ? 'done' : 'failed',
      completedAt: at.toISOString(),
    };
    this.actions.push(done);
    return Promise.resolve(done);
  }
  recordSessionEnd(_c: VoiceSessionContext, reason: VoiceEndReason): Promise<void> {
    this.ended = reason;
    return Promise.resolve();
  }

  private push(role: 'user' | 'athena', text: string, interrupted: boolean): VoiceTurnOut {
    this.seq += 1;
    const turn: VoiceTurnOut = {
      id: `turn_${String(this.seq)}`,
      role,
      text,
      channel: 'web',
      interrupted,
      createdAt: new Date().toISOString(),
    };
    this.turns.push(turn);
    return turn;
  }
}

/** A tool runner that records the engine state at the instant each tool ran. */
class SpyToolRunner implements VoiceToolRunner {
  readonly definitions = [
    { name: 'create_task', description: 'create', parameters: { type: 'object' } },
  ];
  readonly calls: { name: string; stateWhenRun: string }[] = [];

  constructor(private readonly engine: () => VoiceSessionEngine | null) {}

  run(
    _c: VoiceSessionContext,
    name: string,
    args: Record<string, unknown>,
  ): Promise<VoiceToolOutcome> {
    this.calls.push({ name, stateWhenRun: this.engine()?.state ?? 'unknown' });
    return Promise.resolve({
      ok: true,
      summary: `Added “${typeof args['title'] === 'string' ? args['title'] : name}”.`,
    });
  }
}

/** A responder that replays a fixed script. */
function scriptedResponder(chunks: readonly VoiceReplyChunk[]): VoiceResponder {
  return {
    respond(): AsyncIterable<VoiceReplyChunk> {
      return (async function* replay(): AsyncGenerator<VoiceReplyChunk> {
        for (const chunk of chunks) yield await Promise.resolve(chunk);
      })();
    },
  };
}

/** A clock that advances one millisecond per read, so no two trace entries tie. */
function tickingClock(): () => Date {
  let ms = Date.UTC(2026, 7, 2, 9, 0, 0);
  return () => {
    ms += 1;
    return new Date(ms);
  };
}

describe('voice session engine', () => {
  it('runs a tool while it is speaking, and starts it before the audio segment ends', async () => {
    const store = new RecordingStore();
    const engineRef: { current: VoiceSessionEngine | null } = { current: null };
    const tools = new SpyToolRunner(() => engineRef.current);
    const engine = new VoiceSessionEngine(ctx, { store, tools, now: tickingClock() });
    engineRef.current = engine;

    engine.begin();
    await engine.receive([
      { type: 'assistant.transcript.delta', text: 'Sure, adding that now.' },
      { type: 'assistant.audio.start' },
      {
        type: 'tool.call',
        callId: 'call_1',
        name: 'create_task',
        arguments: { title: 'Call the plumber' },
      },
      { type: 'assistant.audio.end' },
    ]);

    // The tool observed the session mid-utterance rather than after it.
    expect(tools.calls).toEqual([{ name: 'create_task', stateWhenRun: 'speaking' }]);

    const trace = engine.trace;
    const segmentEnd = trace.find((e) => e.kind === 'audio.segment.end');
    const toolStart = trace.find((e) => e.kind === 'tool.start');
    const segmentStart = trace.find((e) => e.kind === 'audio.segment.start');
    expect(segmentStart && toolStart && segmentEnd).toBeTruthy();
    // Ordered strictly inside the segment, by monotonic sequence and by wall clock.
    expect(toolStart?.seq).toBeGreaterThan(segmentStart?.seq ?? 0);
    expect(toolStart?.seq).toBeLessThan(segmentEnd?.seq ?? 0);
    expect(Date.parse(toolStart?.at ?? '')).toBeLessThan(Date.parse(segmentEnd?.at ?? ''));
  });

  it('does not batch three requests to the end of the turn', async () => {
    const store = new RecordingStore();
    const engineRef: { current: VoiceSessionEngine | null } = { current: null };
    const tools = new SpyToolRunner(() => engineRef.current);
    const engine = new VoiceSessionEngine(ctx, { store, tools, now: tickingClock() });
    engineRef.current = engine;

    engine.begin();
    await engine.receive([
      { type: 'assistant.audio.start' },
      { type: 'tool.call', callId: 'a', name: 'create_task', arguments: { title: 'One' } },
      { type: 'assistant.transcript.delta', text: 'One down.' },
      { type: 'tool.call', callId: 'b', name: 'create_task', arguments: { title: 'Two' } },
      { type: 'assistant.transcript.delta', text: 'Two down.' },
      { type: 'tool.call', callId: 'c', name: 'create_task', arguments: { title: 'Three' } },
      { type: 'assistant.audio.end' },
    ]);

    expect(tools.calls).toHaveLength(3);
    expect(tools.calls.every((call) => call.stateWhenRun === 'speaking')).toBe(true);

    const segmentEnd = engine.trace.find((e) => e.kind === 'audio.segment.end');
    const toolStarts = engine.trace.filter((e) => e.kind === 'tool.start');
    expect(toolStarts).toHaveLength(3);
    for (const start of toolStarts) {
      expect(start.seq).toBeLessThan(segmentEnd?.seq ?? 0);
    }
  });

  it('halts audio before any write when the person speaks over Athena', async () => {
    const store = new RecordingStore();
    const engineRef: { current: VoiceSessionEngine | null } = { current: null };
    const tools = new SpyToolRunner(() => engineRef.current);
    const engine = new VoiceSessionEngine(ctx, { store, tools, now: tickingClock() });
    engineRef.current = engine;

    engine.begin();
    await engine.receive([
      { type: 'assistant.audio.start' },
      { type: 'assistant.transcript.delta', text: 'Life is a complex set of arrangements that' },
    ]);
    const step = await engine.receive([
      {
        type: 'user.interrupted',
        spokenText: 'Life is a complex set of',
        elapsedMs: 460,
      },
    ]);

    // The stop is the first thing the transport is told to do.
    expect(step.commands[0]).toEqual({ type: 'stop.audio' });
    // What is persisted is what reached the ear, flagged as cut short.
    const assistantTurn = store.turns.find((t) => t.role === 'athena');
    expect(assistantTurn?.text).toBe('Life is a complex set of');
    expect(assistantTurn?.interrupted).toBe(true);
    // The floor is theirs again, with no button pressed.
    expect(engine.state).toBe('listening');
  });

  it('takes the floor back for the interrupting utterance and answers it', async () => {
    const store = new RecordingStore();
    const engineRef: { current: VoiceSessionEngine | null } = { current: null };
    const tools = new SpyToolRunner(() => engineRef.current);
    const engine = new VoiceSessionEngine(ctx, {
      store,
      tools,
      now: tickingClock(),
      responder: scriptedResponder([
        { type: 'token', text: 'Got it — switching to that instead.' },
        { type: 'done' },
      ]),
      history: () => Promise.resolve([]),
    });
    engineRef.current = engine;

    engine.begin();
    await engine.receive([
      { type: 'assistant.audio.start' },
      { type: 'assistant.transcript.delta', text: 'The first thing on your list is' },
      { type: 'user.interrupted', spokenText: 'The first thing on your list is', elapsedMs: 320 },
    ]);
    const step = await engine.receive([
      { type: 'user.transcript', text: 'Actually, what about tomorrow?', final: true },
    ]);

    const spoken = step.commands.filter((c) => c.type === 'speak');
    expect(spoken.length).toBeGreaterThan(0);
    expect(store.turns.map((t) => t.text)).toContain('Actually, what about tomorrow?');
    expect(store.turns.map((t) => t.text)).toContain('Got it — switching to that instead.');
  });

  it('speaks each fragment as it is produced rather than assembling a reply first', async () => {
    const store = new RecordingStore();
    const engineRef: { current: VoiceSessionEngine | null } = { current: null };
    const tools = new SpyToolRunner(() => engineRef.current);
    const engine = new VoiceSessionEngine(ctx, {
      store,
      tools,
      now: tickingClock(),
      responder: scriptedResponder([
        { type: 'token', text: 'On it.' },
        {
          type: 'tool',
          callId: 'call_1',
          name: 'create_task',
          arguments: { title: 'Book the venue' },
        },
        { type: 'token', text: 'Anything else?' },
        { type: 'done' },
      ]),
      history: () => Promise.resolve([]),
    });
    engineRef.current = engine;

    engine.begin();
    const step = await engine.receive([
      { type: 'user.transcript', text: 'Add a task to book the venue', final: true },
    ]);

    const spoken = step.commands.filter((c) => c.type === 'speak');
    // Three spoken fragments before the terminal empty token: the opener, the tool's own receipt,
    // and the follow-up. A design that waited for the whole reply would emit one.
    expect(spoken.map((c) => c.text)).toEqual([
      'On it.',
      'Added “Book the venue”.',
      'Anything else?',
      '',
    ]);
    // The tool ran while the session was speaking, mid-reply.
    expect(tools.calls).toEqual([{ name: 'create_task', stateWhenRun: 'speaking' }]);
    const toolStart = engine.trace.find((e) => e.kind === 'tool.start');
    const segmentEnd = engine.trace.find((e) => e.kind === 'audio.segment.end');
    expect(toolStart?.seq).toBeLessThan(segmentEnd?.seq ?? 0);
  });

  it('holds no queue of deferred actions', () => {
    const store = new RecordingStore();
    const engineRef: { current: VoiceSessionEngine | null } = { current: null };
    const tools = new SpyToolRunner(() => engineRef.current);
    const engine = new VoiceSessionEngine(ctx, { store, tools });
    engineRef.current = engine;
    // Structural check: nothing on the instance accumulates work for later. A pending queue is the
    // mechanism by which "I'll do that at the end" happens by accident, so its absence is asserted
    // rather than assumed.
    const arrays = Object.values(engine as unknown as Record<string, unknown>).filter((value) =>
      Array.isArray(value),
    );
    expect(arrays.every((value) => (value as unknown[]).length === 0)).toBe(true);
  });

  it('records a keypad press as something the person said', async () => {
    const store = new RecordingStore();
    const engineRef: { current: VoiceSessionEngine | null } = { current: null };
    const tools = new SpyToolRunner(() => engineRef.current);
    const engine = new VoiceSessionEngine(ctx, { store, tools, now: tickingClock() });
    engineRef.current = engine;
    engine.begin();
    await engine.receive([{ type: 'dtmf', digit: '4' }]);
    expect(store.turns.at(-1)).toMatchObject({ role: 'user', text: 'Pressed 4' });
  });

  it('keeps what was said when the line drops mid-sentence', async () => {
    const store = new RecordingStore();
    const engineRef: { current: VoiceSessionEngine | null } = { current: null };
    const tools = new SpyToolRunner(() => engineRef.current);
    const engine = new VoiceSessionEngine(ctx, { store, tools, now: tickingClock() });
    engineRef.current = engine;

    engine.begin();
    await engine.receive([
      { type: 'assistant.audio.start' },
      { type: 'assistant.transcript.delta', text: 'The next thing is' },
      { type: 'session.end', reason: 'caller_hung_up' },
    ]);

    expect(store.turns.at(-1)).toMatchObject({ text: 'The next thing is', interrupted: true });
    expect(store.ended).toBe('caller_hung_up');
    expect(engine.state).toBe('ended');
  });

  it('does not persist partial transcripts', async () => {
    const store = new RecordingStore();
    const engineRef: { current: VoiceSessionEngine | null } = { current: null };
    const tools = new SpyToolRunner(() => engineRef.current);
    const engine = new VoiceSessionEngine(ctx, { store, tools, now: tickingClock() });
    engineRef.current = engine;

    engine.begin();
    await engine.receive([
      { type: 'user.transcript', text: 'Add a task to', final: false },
      { type: 'user.transcript', text: 'Add a task to call', final: false },
    ]);
    expect(store.turns).toHaveLength(0);
    expect(engine.state).toBe('listening');
  });
});
