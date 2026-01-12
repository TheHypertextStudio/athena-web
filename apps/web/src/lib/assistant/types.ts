/**
 * Assistant types for the Athena AI chat interface.
 *
 * These types mirror the backend AI service types and add UI-specific
 * state management types for streaming, tool execution, and object rendering.
 *
 * @packageDocumentation
 */

// =============================================================================
// Backend-Aligned Types (mirror apps/api/src/services/ai/types.ts)
// =============================================================================

/**
 * Supported LLM providers.
 */
export type AIProvider = 'openai' | 'anthropic' | 'google';

/**
 * Message role in a conversation.
 */
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

/**
 * A tool call requested by the AI.
 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * A chunk of a streaming response from the backend.
 */
export interface StreamChunk {
  type: 'content' | 'tool_call' | 'done' | 'error';
  /** Text content for content chunks */
  content?: string;
  /** Tool call for tool_call chunks */
  toolCall?: ToolCall;
  /** Error message for error chunks */
  error?: string;
  /** Full response when done */
  fullResponse?: {
    content: string;
    toolCalls: ToolCall[];
    usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
    model: string;
    finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter';
  };
}

// =============================================================================
// UI State Types
// =============================================================================

/**
 * Status of a message in the UI.
 */
export type MessageStatus = 'pending' | 'streaming' | 'complete' | 'error';

/**
 * Status of a tool call execution.
 */
export type ToolCallStatus = 'pending' | 'running' | 'complete' | 'error';

/**
 * Object types that can be referenced or created by tool calls.
 */
export type ObjectType = 'task' | 'event' | 'project' | 'initiative';

/**
 * Action that was taken on an object by a tool.
 */
export type ObjectAction = 'created' | 'updated' | 'returned' | 'deleted';

// =============================================================================
// Type-Safe Object Data Interfaces
// =============================================================================

/**
 * Task object data returned from tool calls.
 */
export interface TaskObjectData {
  id: string;
  title: string;
  description?: string;
  status?: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  dueDate?: string;
  projectId?: string;
  tags?: string[];
  [key: string]: unknown; // Allow additional properties from API
}

/**
 * Event object data returned from tool calls.
 */
export interface EventObjectData {
  id: string;
  title: string;
  description?: string;
  startTime: string;
  endTime?: string;
  location?: string;
  isAllDay?: boolean;
  [key: string]: unknown; // Allow additional properties from API
}

/**
 * Project object data returned from tool calls.
 */
export interface ProjectObjectData {
  id: string;
  name: string;
  description?: string;
  color?: string;
  status?: 'active' | 'archived' | 'completed';
  [key: string]: unknown; // Allow additional properties from API
}

/**
 * Initiative object data returned from tool calls.
 */
export interface InitiativeObjectData {
  id: string;
  name: string;
  description?: string;
  status?: 'active' | 'archived' | 'completed';
  [key: string]: unknown; // Allow additional properties from API
}

/**
 * Map of object types to their data interfaces.
 */
export interface ObjectDataMap {
  task: TaskObjectData;
  event: EventObjectData;
  project: ProjectObjectData;
  initiative: InitiativeObjectData;
}

/**
 * A reference to an object created or returned by a tool call.
 *
 * The `data` property is typed as `unknown` for flexibility when creating references.
 * Use the `isObjectOfType` type guard for type-safe access when consuming references.
 */
export interface ObjectReference {
  /** Type of the object */
  type: ObjectType;
  /** Unique identifier */
  id: string;
  /** Action that was taken */
  action: ObjectAction;
  /** Object data (use type guard for type-safe access) */
  data: unknown;
}

/**
 * Type-safe object reference for when the type is known.
 * Use this when you need type-safe access to the data property.
 */
export interface TypedObjectReference<T extends ObjectType> extends Omit<
  ObjectReference,
  'type' | 'data'
> {
  /** Type of the object */
  type: T;
  /** Type-safe object data */
  data: ObjectDataMap[T];
}

/**
 * Type guard to check if an ObjectReference is of a specific type.
 * After narrowing, `data` will be typed according to the object type.
 *
 * @example
 * ```typescript
 * if (isObjectOfType(ref, 'task')) {
 *   // ref.data is now TaskObjectData
 *   console.log(ref.data.title);
 * }
 * ```
 */
export function isObjectOfType<T extends ObjectType>(
  ref: ObjectReference,
  type: T,
): ref is TypedObjectReference<T> {
  return ref.type === type;
}

/**
 * UI state for a tool call, extending backend ToolCall with execution status.
 */
export interface ToolCallState extends ToolCall {
  /** Current execution status */
  status: ToolCallStatus;
  /** Result from tool execution (if complete) */
  result?: unknown;
  /** Error message (if error) */
  error?: string;
  /** Objects extracted from the result */
  objects?: ObjectReference[];
}

/**
 * A message in the assistant conversation UI.
 */
export interface AssistantMessage {
  /** Unique identifier */
  id: string;
  /** Message role */
  role: 'user' | 'assistant';
  /** Text content */
  content: string;
  /** Current status in the UI */
  status: MessageStatus;
  /** Tool calls made by the assistant (assistant messages only) */
  toolCalls: ToolCallState[];
  /** Objects created or returned (extracted from tool calls) */
  createdObjects: ObjectReference[];
  /** When the message was created */
  timestamp: Date;
}

/**
 * A conversation in the assistant.
 */
export interface Conversation {
  /** Unique identifier */
  id: string;
  /** Title (generated or user-provided) */
  title: string | null;
  /** Status */
  status: 'active' | 'archived' | 'deleted';
  /** Creation timestamp */
  createdAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
  /** Messages in the conversation */
  messages: AssistantMessage[];
}

// =============================================================================
// Store Types
// =============================================================================

/**
 * State managed by the assistant conversation store.
 */
export interface AssistantState {
  /** Active conversation ID */
  activeConversationId: string | null;
  /** Messages in the current conversation */
  messages: AssistantMessage[];
  /** Whether a response is currently streaming */
  isStreaming: boolean;
  /** Current streaming message ID (if streaming) */
  streamingMessageId: string | null;
  /** Error state */
  error: string | null;
  /** Whether a conversation is being loaded */
  isLoadingConversation: boolean;
}

/**
 * Actions available on the assistant store.
 */
export interface AssistantActions {
  /** Create a new conversation */
  createConversation: () => Promise<string>;
  /** Load an existing conversation */
  loadConversation: (id: string) => Promise<void>;
  /** Send a message and stream the response */
  sendMessage: (message: string) => Promise<void>;
  /** Add a user message (optimistic) */
  addUserMessage: (content: string) => string;
  /** Start a streaming assistant message */
  startAssistantMessage: () => string;
  /** Update a streaming message with new content */
  updateStreamingContent: (messageId: string, content: string) => void;
  /** Add a tool call to a message */
  addToolCall: (messageId: string, toolCall: ToolCall) => void;
  /** Update a tool call status */
  updateToolCallStatus: (
    messageId: string,
    toolCallId: string,
    status: ToolCallStatus,
    result?: unknown,
    error?: string,
  ) => void;
  /** Complete a streaming message */
  completeMessage: (messageId: string) => void;
  /** Mark a message as error */
  errorMessage: (messageId: string, error: string) => void;
  /** Clear the current conversation (for inline mode) */
  clearConversation: () => void;
  /** Set error state */
  setError: (error: string | null) => void;
  /** Abort the current stream */
  abortStream: () => void;
}

/**
 * Combined store type.
 */
export type AssistantStore = AssistantState & AssistantActions;

// =============================================================================
// Component Props Types
// =============================================================================

/**
 * Variant for the assistant chat component.
 */
export type ChatVariant = 'compact' | 'modal' | 'full';

/**
 * Props for the AssistantChat component.
 */
export interface AssistantChatProps {
  /** Display variant */
  variant: ChatVariant;
  /** Optional class name */
  className?: string;
  /** Callback when expand is requested */
  onExpand?: () => void;
  /** Callback when close is requested */
  onClose?: () => void;
}

/**
 * Props for the AssistantMessage component.
 */
export interface AssistantMessageProps {
  /** The message to render */
  message: AssistantMessage;
  /** Whether this is the last message (affects styling) */
  isLast?: boolean;
  /** Display variant */
  variant?: ChatVariant;
}

/**
 * Props for the AssistantToolCard component.
 */
export interface AssistantToolCardProps {
  /** The tool call to render */
  toolCall: ToolCallState;
  /** Whether to show in compact mode */
  compact?: boolean;
}

/**
 * Props for the AssistantObjectCard component.
 */
export interface AssistantObjectCardProps {
  /** The object reference to render */
  reference: ObjectReference;
  /** Display variant */
  variant?: 'compact' | 'normal';
  /** Callback when an action is taken */
  onAction?: (action: string) => void;
}

// =============================================================================
// Tool Metadata
// =============================================================================

/**
 * Human-readable labels for tool names.
 */
export const TOOL_LABELS: Record<string, string> = {
  list_tasks: 'Fetching tasks',
  create_task: 'Creating task',
  update_task: 'Updating task',
  complete_task: 'Completing task',
  search_tasks: 'Searching tasks',
  list_projects: 'Fetching projects',
  list_events: 'Fetching events',
  create_event: 'Creating event',
  get_agenda: 'Getting agenda',
  start_timer: 'Starting timer',
  stop_timer: 'Stopping timer',
  get_timer_status: 'Checking timer',
  get_productivity_summary: 'Getting productivity stats',
};

/**
 * Icon names for tool types (mapped to Lucide icons).
 */
export const TOOL_ICONS: Record<string, string> = {
  list_tasks: 'ListTodo',
  create_task: 'Plus',
  update_task: 'Pencil',
  complete_task: 'CheckCircle',
  search_tasks: 'Search',
  list_projects: 'FolderKanban',
  list_events: 'Calendar',
  create_event: 'CalendarPlus',
  get_agenda: 'CalendarDays',
  start_timer: 'Play',
  stop_timer: 'Square',
  get_timer_status: 'Timer',
  get_productivity_summary: 'BarChart3',
};
