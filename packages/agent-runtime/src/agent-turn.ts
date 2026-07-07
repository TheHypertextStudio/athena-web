/**
 * `@docket/agent-runtime` - one-turn LLM runtime contracts and test double.
 *
 * @remarks
 * The host owns the durable agentic loop: transcript persistence, tool execution,
 * approval gating, and resume. This port owns exactly one provider turn: the host
 * passes the full conversation plus tools and receives streamed turn events ending
 * with a complete assistant message that can be appended verbatim.
 */

import type { TurnContentBlock, TurnMessage } from '@docket/types';

export type { TurnContentBlock, TurnMessage };

/** One tool made available to the model for this turn. */
export interface TurnToolDef {
  /** The tool name the model calls it by. */
  readonly name: string;
  /** What the tool does. */
  readonly description: string;
  /** The JSON Schema for the tool's input. */
  readonly inputSchema: Record<string, unknown>;
}

/** Why the provider ended the turn. */
export type TurnStopReason = 'end_turn' | 'tool_use' | 'refusal' | 'max_tokens';

/** One event streamed while a turn is in flight. */
export type TurnEvent =
  | {
      /** A completed reasoning block. */
      readonly type: 'thinking';
      /** The reasoning text. */
      readonly text: string;
    }
  | {
      /** A completed text block. */
      readonly type: 'text';
      /** The text content. */
      readonly text: string;
    }
  | {
      /** A completed tool invocation request. */
      readonly type: 'tool_use';
      /** The provider block id. */
      readonly id: string;
      /** The tool name. */
      readonly name: string;
      /** The parsed tool input. */
      readonly input: unknown;
    }
  | {
      /** The terminal event of every turn. */
      readonly type: 'turn_end';
      /** Why the turn ended. */
      readonly stopReason: TurnStopReason;
      /** The complete assembled assistant message. */
      readonly message: TurnMessage;
    };

/** Input for one provider turn: the full conversation state. */
export interface TurnInput {
  /** The system prompt. */
  readonly system: string;
  /** The conversation so far. */
  readonly messages: readonly TurnMessage[];
  /** The tools available this turn. */
  readonly tools: readonly TurnToolDef[];
}

/** The one-turn agent runtime port. */
export interface AgentTurnRuntime {
  /**
   * Stream one model turn for the given conversation state.
   *
   * @param input - The system prompt, message history, and available tools.
   */
  streamTurn(input: TurnInput): AsyncIterable<TurnEvent>;
}

/** One scripted turn: the assistant message to replay and how the turn ends. */
export interface ScriptedTurn {
  /** The complete assistant message for this turn. */
  readonly message: TurnMessage;
  /** The stop reason `turn_end` reports. */
  readonly stopReason: TurnStopReason;
}

/** The default turn script {@link MockAgentTurnRuntime} replays. */
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

/** The Sunsama-import turn script used by onboarding/firehose tests. */
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
  /** The turn script to replay. */
  readonly script?: readonly ScriptedTurn[];
}

/** A deterministic turn runtime that replays a fixed script, one turn per call. */
export class MockAgentTurnRuntime implements AgentTurnRuntime {
  private readonly script: readonly ScriptedTurn[];

  /**
   * @param options - Optional override for the replayed turn script.
   */
  constructor(options: MockAgentTurnRuntimeOptions = {}) {
    this.script = options.script ?? SCRIPTED_TURNS;
  }

  /** {@inheritDoc AgentTurnRuntime.streamTurn} */
  async *streamTurn(input: TurnInput): AsyncIterable<TurnEvent> {
    const turnIndex = input.messages.filter((m) => m.role === 'assistant').length;
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
