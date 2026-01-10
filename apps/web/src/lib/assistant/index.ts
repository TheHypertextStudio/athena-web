/**
 * Assistant module exports.
 *
 * @packageDocumentation
 */

// Types
export type {
  AIProvider,
  MessageRole,
  ToolCall,
  StreamChunk,
  MessageStatus,
  ToolCallStatus,
  ObjectType,
  ObjectAction,
  ObjectReference,
  ToolCallState,
  AssistantMessage,
  Conversation,
  AssistantState,
  AssistantActions,
  AssistantStore,
  ChatVariant,
  AssistantChatProps,
  AssistantMessageProps,
  AssistantToolCardProps,
  AssistantObjectCardProps,
} from './types';

export { TOOL_LABELS, TOOL_ICONS } from './types';

// Stream parser
export {
  parseStream,
  streamChat,
  StreamParseError,
  createTimeoutController,
  createCombinedSignal,
} from './stream-parser';

export type { CombinedSignalResult } from './stream-parser';

// Store
export {
  useAssistantStore,
  selectMessages,
  selectIsStreaming,
  selectError,
  selectConversationId,
  selectIsLoadingConversation,
} from './conversation-store';

// Object extractor
export {
  extractObjectsFromToolResult,
  toolReturnsObjects,
  getToolObjectType,
} from './object-extractor';
