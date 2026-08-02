/**
 * `@docket/agent-runtime` - the `AgentRuntime` port.
 *
 * @remarks
 * The single typed edge to an agent execution backend. `startSession` returns an
 * async stream of `SessionActivity` (`thought → action(proposed) → elicitation →
 * response`). The real adapter speaks to a provider runtime (Athena/Claude/Codex via
 * API/MCP, env keys); the mock replays scripted fixture sessions. Session hosting,
 * the approval gate, and principal-vs-initiator accountability are real business
 * logic exercised against this port; only the I/O edge is swapped by the app container.
 * The activity shape mirrors `@docket/db`'s `SessionActivityBody` loosely.
 */

/** The kind of one streamed agent activity. */
export type SessionActivityType = 'thought' | 'action' | 'response' | 'elicitation' | 'error';

/** The approval marker on an activity: only `action` rows propose a gated change. */
export type SessionActivityApproval = 'proposed';

/**
 * The structured payload of an `action` activity (a proposed, gated change).
 *
 * @remarks
 * Mirrors the `action` shape on `@docket/db`'s `SessionActivityBody` so hosted
 * sessions can be persisted without translation.
 */
export interface SessionActionBody {
  /** Action kind (e.g. `update_task`). */
  readonly kind: string;
  /** Human-readable summary of the proposed change. */
  readonly summary: string;
  /** Optional structured diff describing the change. */
  readonly diff?: unknown;
}

/**
 * One activity emitted by an agent session stream.
 *
 * @remarks
 * `body` is free text for `thought`/`response`/`elicitation`/`error`, and the
 * proposed change for `action`. `approval: 'proposed'` marks an action that must pass
 * the approval gate before it is applied.
 */
export interface SessionActivity {
  /** The activity kind. */
  readonly type: SessionActivityType;
  /** Free text, or — for `action` activities — the proposed change. */
  readonly body: string | SessionActionBody;
  /** Set to `'proposed'` on gated `action` activities awaiting approval. */
  readonly approval?: SessionActivityApproval;
}

/** Input to start a hosted agent session. */
export interface StartSessionInput {
  /** The hosting session id (Docket-owned; correlates persisted activities). */
  readonly sessionId: string;
  /** The task the agent should work on (id or natural-language brief). */
  readonly task: string;
  /** The agent identifier/slug to run the task as. */
  readonly agent: string;
}

/**
 * The agent execution port: a single typed edge that streams a session's activities.
 * Implemented by `RealProviderRuntime` and `MockAgentRuntime`.
 */
export interface AgentRuntime {
  /**
   * Start a session and stream its activities as they are produced.
   *
   * @param input - The session id, task, and agent to run.
   * @returns an async iterable of {@link SessionActivity} in emission order.
   */
  startSession(input: StartSessionInput): AsyncIterable<SessionActivity>;
}

export {
  AGENT_UPDATE_KINDS,
  DEFAULT_AGENT_BUS_RETENTION,
  InMemoryAgentBus,
  TERMINAL_AGENT_UPDATE_KINDS,
  agentIntervalsOverlap,
  projectAgentStates,
} from './agent-bus';
export type {
  AgentBus,
  AgentBusFilter,
  AgentBusListener,
  AgentIdentity,
  AgentUpdate,
  AgentUpdateInput,
  AgentUpdateKind,
  InMemoryAgentBusOptions,
} from './agent-bus';
export {
  DEFAULT_DEPTH_TOLERANCE,
  DEFAULT_MIN_SEGMENT_SIZE,
  DEFAULT_SEGMENT_WINDOW,
  LexicalCohesionSegmenter,
  SEGMENT_TITLE_MAX,
  stemWord,
  topicTerms,
} from './conversation-segmenter';
export type {
  ConversationMessage,
  ConversationSegment,
  ConversationSegmenter,
  LexicalCohesionSegmenterOptions,
} from './conversation-segmenter';
export {
  cosineSimilarity,
  matchSpans,
  searchConversation,
  withinRange,
} from './conversation-search';
export type {
  ConversationEmbedder,
  ConversationSearchHit,
  ConversationSearchOptions,
  ConversationSearchQuery,
  ConversationSearchResult,
  ConversationVectors,
  TextSpan,
} from './conversation-search';
export {
  DEFAULT_ATHENA_MODEL,
  MOCK_ATHENA_MODEL,
  MODEL_BACKEND_IDS,
  ModelBackendConfigError,
  resolveModelBackend,
  selectModelBackendId,
} from './model-backend';
export type {
  LatticeBackendConfig,
  ModelBackend,
  ModelBackendDescriptor,
  ModelBackendEnv,
  ModelBackendId,
  ResolveModelBackendOptions,
} from './model-backend';
export {
  DEFAULT_DESCRIPTION_WEIGHT,
  DEFAULT_PARENT_THRESHOLD,
  WORK_PARENT_KINDS,
  describeParentResolution,
  resolveWorkParent,
} from './work-linkage';
export type {
  ParentCandidate,
  ParentResolution,
  ParentResolutionReason,
  ResolveWorkParentOptions,
  WorkParentKind,
} from './work-linkage';
export type {
  SummarizeInput,
  SummarizeResult,
  Summarizer,
  SummarizerObservation,
} from './summarizer';
export type { TaskDraft, TaskDraftInput, TaskSynthesizer } from './task-synthesizer';
export { TITLE_MAX, truncateTitle } from './task-synthesizer';
export { MockAgentTurnRuntime, SCRIPTED_TURNS, SUNSAMA_IMPORT_TURNS } from './agent-turn';
export type {
  AgentTurnRuntime,
  MockAgentTurnRuntimeOptions,
  ScriptedTurn,
  TurnContentBlock,
  TurnEvent,
  TurnInput,
  TurnMessage,
  TurnStopReason,
  TurnToolDef,
} from './agent-turn';
export { MockAgentRuntime } from './mock-agent-runtime';
export type { MockAgentRuntimeOptions } from './mock-agent-runtime';
export { MockSummarizer } from './mock-summarizer';
export { MockTaskSynthesizer } from './mock-task-synthesizer';
export { makeAnthropicClient, anthropicClientOptions, wrapAnthropicError } from './anthropic';
export type { AnthropicClientConfig } from './anthropic';
export {
  RealProviderRuntime,
  blockKind,
  toActionBody,
  translateEvents,
} from './real-agent-runtime';
export type { BlockBuffer, RealProviderRuntimeConfig } from './real-agent-runtime';
export {
  DEFAULT_LATTICE_MAX_TOKENS,
  LatticeAgentTurnRuntime,
  buildLatticeTurnMessages,
  countToolUses,
  flattenTranscript,
  toLatticeStopReason,
} from './lattice-turn';
export type {
  LatticeChatMessage,
  LatticeChatPort,
  LatticeChatPortRequest,
  LatticeChatPortResult,
  LatticeTurnRuntimeConfig,
} from './lattice-turn';
export {
  latticeToolUseId,
  parseLatticeReply,
  renderToolCall,
  renderToolInstructions,
  renderToolResult,
} from './lattice-tool-protocol';
export type { LatticeToolParse } from './lattice-tool-protocol';
export { RealSummarizer } from './real-summarizer';
export type { RealSummarizerConfig } from './real-summarizer';
export { RealTaskSynthesizer } from './real-task-synthesizer';
export type { RealTaskSynthesizerConfig } from './real-task-synthesizer';
export {
  DEFAULT_TURN_MAX_TOKENS,
  DEFAULT_TURN_MODEL,
  RealAgentTurnRuntime,
  buildTurnRequest,
  defaultTurnStreamer,
  parseToolInput,
  toStopReason,
  translateTurnEvents,
  wrapTurnError,
} from './real-agent-turn';
export type { RealAgentTurnRuntimeConfig, TurnStreamer } from './real-agent-turn';
