/**
 * `@docket/agent-runtime` - `MockAgentRuntime`.
 *
 * @remarks
 * A deterministic, offline {@link AgentRuntime} that replays the scripted
 * {@link SCRIPTED_SESSION} fixture (`thought → action(proposed) → elicitation →
 * response`) as an async stream. No wall-clock time and no randomness, so the hosting
 * layer's approval gate is exercised against a stable sequence.
 */
import type { AgentRuntime, SessionActivity, StartSessionInput } from './index';

const SCRIPTED_SESSION: readonly SessionActivity[] = [
  { type: 'thought', body: 'Reviewing the task and the current board state.' },
  {
    type: 'action',
    body: {
      kind: 'update_task',
      summary: 'Move task to In Progress',
      diff: { state: { from: 'todo', to: 'in_progress' } },
    },
    approval: 'proposed',
  },
  { type: 'elicitation', body: 'Should I also assign this task to you?' },
  { type: 'response', body: 'Proposed moving the task to In Progress; awaiting approval.' },
];

/** Construction options for {@link MockAgentRuntime}. */
export interface MockAgentRuntimeOptions {
  /** The activity script to replay (defaults to {@link SCRIPTED_SESSION}). */
  readonly script?: readonly SessionActivity[];
}

/**
 * A mock agent runtime that streams a fixed, scripted session.
 *
 * @remarks
 * The stream yields the configured script verbatim and in order, then completes —
 * making it safe to `for await` in tests without timeouts or flakiness.
 */
export class MockAgentRuntime implements AgentRuntime {
  private readonly script: readonly SessionActivity[];

  /**
   * @param options - Optional override for the replayed activity script.
   */
  constructor(options: MockAgentRuntimeOptions = {}) {
    this.script = options.script ?? SCRIPTED_SESSION;
  }

  /** {@inheritDoc AgentRuntime.startSession} */
  async *startSession(_input: StartSessionInput): AsyncIterable<SessionActivity> {
    for (const activity of this.script) {
      yield activity;
    }
  }
}
