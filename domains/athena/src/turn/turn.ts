/**
 * Athena's provider-neutral, one-turn runtime boundary.
 *
 * The host owns the durable loop: persistence, tool execution, approvals, and resume. This
 * boundary owns exactly one model turn, so every delivery runtime can exchange the same appendable
 * transcript message and event stream.
 */
import type { TurnContentBlock, TurnMessage } from '../turn-protocol';

export type { TurnContentBlock, TurnMessage };

/** One tool the model may call during this turn. */
export interface TurnToolDef {
  /** The stable tool name exposed to the model. */
  readonly name: string;
  /** A human-readable description of what the tool does. */
  readonly description: string;
  /** The JSON Schema for the tool input. */
  readonly inputSchema: Record<string, unknown>;
}

/** Why the provider stopped generating the turn. */
export type TurnStopReason = 'end_turn' | 'tool_use' | 'refusal' | 'max_tokens';

/** A completed event emitted while one model turn is running. */
export type TurnEvent =
  | {
      /** A completed reasoning block. */
      readonly type: 'thinking';
      /** The completed reasoning text. */
      readonly text: string;
    }
  | {
      /** A completed visible text block. */
      readonly type: 'text';
      /** The completed visible text. */
      readonly text: string;
    }
  | {
      /** A completed tool invocation request. */
      readonly type: 'tool_use';
      /** The provider block id. */
      readonly id: string;
      /** The stable tool name. */
      readonly name: string;
      /** Parsed tool input. */
      readonly input: unknown;
    }
  | {
      /** The terminal event every turn emits. */
      readonly type: 'turn_end';
      /** Why generation stopped. */
      readonly stopReason: TurnStopReason;
      /** The complete assistant message ready to append to the transcript. */
      readonly message: TurnMessage;
    };

/** Input to one model turn: durable context plus the tools it may use. */
export interface TurnInput {
  /** The system prompt for the turn. */
  readonly system: string;
  /** The full durable conversation so far. */
  readonly messages: readonly TurnMessage[];
  /** The tools available during this turn. */
  readonly tools: readonly TurnToolDef[];
}

/** Provider-neutral port for streaming one model turn. */
export interface AgentTurnRuntime {
  /** Stream a model turn for the supplied context. */
  streamTurn(input: TurnInput): AsyncIterable<TurnEvent>;
}

/** One deterministic turn: the assistant message to replay and why it ends. */
export interface ScriptedTurn {
  /** The complete assistant message for this turn. */
  readonly message: TurnMessage;
  /** The stop reason the terminal event reports. */
  readonly stopReason: TurnStopReason;
}

/** The default script {@link MockAgentTurnRuntime} replays in deterministic tests. */
export const SCRIPTED_TURNS: readonly ScriptedTurn[] = [
  {
    message: {
      role: 'assistant',
      content: [
        {
          type: 'thinking',
          thinking: 'Reviewing the task and the current board state.',
          signature: 'mock-sig-turn-0',
        },
        {
          type: 'tool_use',
          id: 'toolu_mock_0001',
          name: 'update_task',
          input: { taskId: '01HZ0000000000000000LN0001', state: 'in_progress' },
        },
      ],
    },
    stopReason: 'tool_use',
  },
  {
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Moved the task to In Progress and verified the board reflects it.' },
      ],
    },
    stopReason: 'end_turn',
  },
];

/** The Sunsama-import script used by onboarding and firehose tests. */
export const SUNSAMA_IMPORT_TURNS: readonly ScriptedTurn[] = [
  {
    message: {
      role: 'assistant',
      content: [
        {
          type: 'thinking',
          thinking: 'Reading the full Sunsama backlog before proposing any structure.',
          signature: 'mock-sig-sunsama-0',
        },
        {
          type: 'tool_use',
          id: 'toolu_mock_su01',
          name: 'sunsama__get_backlog_tasks',
          input: {},
        },
      ],
    },
    stopReason: 'tool_use',
  },
  {
    message: {
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: 'I read 3 backlog tasks. Proposing them as Docket tasks in one batch.',
        },
        {
          type: 'tool_use',
          id: 'toolu_mock_su02',
          name: 'create_task',
          input: { title: 'Send the contractor agreement' },
        },
        {
          type: 'tool_use',
          id: 'toolu_mock_su03',
          name: 'create_task',
          input: { title: 'Book the venue for the offsite' },
        },
        {
          type: 'tool_use',
          id: 'toolu_mock_su04',
          name: 'create_task',
          input: { title: 'Reply to the partnership email' },
        },
      ],
    },
    stopReason: 'tool_use',
  },
  {
    message: {
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: 'Imported 3 tasks from your Sunsama backlog. All are in your triage lane.',
        },
      ],
    },
    stopReason: 'end_turn',
  },
];

/** Construction options for {@link MockAgentTurnRuntime}. */
export interface MockAgentTurnRuntimeOptions {
  /** Optional override for the script to replay. */
  readonly script?: readonly ScriptedTurn[];
}

/** Deterministic runtime that replays one scripted turn per call. */
export class MockAgentTurnRuntime implements AgentTurnRuntime {
  private readonly script: readonly ScriptedTurn[];

  /** Create the runtime with its default or injected script. */
  constructor(options: MockAgentTurnRuntimeOptions = {}) {
    this.script = options.script ?? SCRIPTED_TURNS;
  }

  /** Replay the turn matching the number of persisted assistant messages. */
  async *streamTurn(input: TurnInput): AsyncIterable<TurnEvent> {
    const turnIndex = input.messages.filter((message) => message.role === 'assistant').length;
    const turn = this.script[turnIndex];
    if (!turn) {
      throw new Error(
        `MockAgentTurnRuntime: conversation has ${turnIndex} assistant turns but the script ` +
          `has only ${this.script.length}; the hosting loop ran past the end of the script.`,
      );
    }

    for (const block of turn.message.content) {
      if (block.type === 'thinking') {
        yield { type: 'thinking', text: block.thinking };
      } else if (block.type === 'text') {
        yield { type: 'text', text: block.text };
      } else if (block.type === 'tool_use') {
        yield { type: 'tool_use', id: block.id, name: block.name, input: block.input };
      }
    }

    yield { type: 'turn_end', stopReason: turn.stopReason, message: turn.message };
  }
}
