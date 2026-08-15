import type { AgentRuntime, SessionActivity, StartSessionInput } from './agent-session-contracts';

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

/** Optional deterministic script override for {@link MockAgentRuntime}. */
export interface MockAgentRuntimeOptions {
  /** Activity sequence to replay, in order. */
  readonly script?: readonly SessionActivity[];
}

/** Offline session adapter for local development and deterministic tests. */
export class MockAgentRuntime implements AgentRuntime {
  private readonly script: readonly SessionActivity[];

  constructor(options: MockAgentRuntimeOptions = {}) {
    this.script = options.script ?? SCRIPTED_SESSION;
  }

  /** Replay the configured session script exactly, without time or network dependencies. */
  async *startSession(_input: StartSessionInput): AsyncIterable<SessionActivity> {
    for (const activity of this.script) yield activity;
  }
}
