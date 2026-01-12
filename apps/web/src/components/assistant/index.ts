/**
 * Assistant component exports.
 *
 * @packageDocumentation
 */

// Core components
export { AssistantChat } from './assistant-chat';
export { AssistantMessages } from './assistant-messages';
export { AssistantMessage } from './assistant-message';
export { AssistantInput } from './assistant-input';
export { AssistantTypingIndicator } from './assistant-typing-indicator';
export { AssistantErrorBoundary } from './assistant-error-boundary';

// Rich content components
export { AssistantStreamingContent } from './assistant-streaming-content';
export { AssistantMarkdownContent } from './assistant-markdown-content';
export { AssistantToolCard } from './assistant-tool-card';
export { AssistantObjectCard } from './assistant-object-card';

// Re-export types for convenience
export type {
  AssistantChatProps,
  AssistantMessageProps,
  AssistantToolCardProps,
  AssistantObjectCardProps,
} from '@/lib/assistant';
