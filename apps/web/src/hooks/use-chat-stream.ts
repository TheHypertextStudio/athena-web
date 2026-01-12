/**
 * React hook for AI chat streaming.
 *
 * Provides a clean interface for components to interact with the assistant,
 * wrapping the Zustand store with convenient React patterns.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo } from 'react';
import {
  useAssistantStore,
  selectMessages,
  selectIsStreaming,
  selectError,
  selectConversationId,
  selectIsLoadingConversation,
} from '@/lib/assistant';
import type { AssistantMessage, ChatVariant } from '@/lib/assistant';

/**
 * Options for the useChatStream hook.
 */
export interface UseChatStreamOptions {
  /** Chat variant affects behavior (e.g., clearing on close for compact) */
  variant?: ChatVariant;
  /** Callback when a message is successfully sent */
  onMessageSent?: (message: string) => void;
  /** Callback when streaming completes */
  onStreamComplete?: () => void;
  /** Callback when an error occurs */
  onError?: (error: string) => void;
}

/**
 * Return type for the useChatStream hook.
 */
export interface UseChatStreamReturn {
  /** Current messages in the conversation */
  messages: AssistantMessage[];
  /** Whether a response is currently streaming */
  isStreaming: boolean;
  /** Whether the conversation is loading (initial fetch) */
  isLoading: boolean;
  /** Current error message, if any */
  error: string | null;
  /** Active conversation ID */
  conversationId: string | null;
  /** Whether there are any messages */
  hasMessages: boolean;
  /** The last message in the conversation */
  lastMessage: AssistantMessage | null;
  /** Whether the last message is from the assistant */
  isAssistantTurn: boolean;
  /** Send a message to the assistant */
  sendMessage: (message: string) => Promise<void>;
  /** Clear the current conversation */
  clearConversation: () => void;
  /** Load an existing conversation */
  loadConversation: (id: string) => Promise<void>;
  /** Clear any error state */
  clearError: () => void;
  /** Retry the last failed message */
  retryLastMessage: () => Promise<void>;
  /** Abort the current streaming response */
  abortStream: () => void;
}

/**
 * Hook for managing AI chat streaming.
 *
 * Provides a complete interface for sending messages, receiving streaming
 * responses, and managing conversation state.
 *
 * @param options - Configuration options
 * @returns Chat state and actions
 *
 * @example
 * ```tsx
 * function ChatComponent() {
 *   const {
 *     messages,
 *     isStreaming,
 *     sendMessage,
 *     clearConversation,
 *   } = useChatStream({ variant: 'compact' });
 *
 *   const handleSubmit = (text: string) => {
 *     sendMessage(text);
 *   };
 *
 *   return (
 *     <div>
 *       {messages.map(msg => <Message key={msg.id} message={msg} />)}
 *       <Input onSubmit={handleSubmit} disabled={isStreaming} />
 *     </div>
 *   );
 * }
 * ```
 */
export function useChatStream(options: UseChatStreamOptions = {}): UseChatStreamReturn {
  const { onMessageSent, onStreamComplete, onError } = options;

  // Select state from store using stable selectors
  const messages = useAssistantStore(selectMessages);
  const isStreaming = useAssistantStore(selectIsStreaming);
  const error = useAssistantStore(selectError);
  const conversationId = useAssistantStore(selectConversationId);
  const isLoading = useAssistantStore(selectIsLoadingConversation);

  // Get actions from store
  const storeSendMessage = useAssistantStore((state) => state.sendMessage);
  const storeClearConversation = useAssistantStore((state) => state.clearConversation);
  const storeLoadConversation = useAssistantStore((state) => state.loadConversation);
  const storeSetError = useAssistantStore((state) => state.setError);
  const storeAbortStream = useAssistantStore((state) => state.abortStream);

  // Memoized derived state to prevent unnecessary re-renders
  const derivedState = useMemo(() => {
    const hasMessages = messages.length > 0;
    const lastMessage = hasMessages ? (messages[messages.length - 1] ?? null) : null;
    const isAssistantTurn = lastMessage?.role === 'assistant';
    return { hasMessages, lastMessage, isAssistantTurn };
  }, [messages]);

  // Store the last user message for retry functionality
  const lastUserMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg?.role === 'user') {
        return msg.content;
      }
    }
    return null;
  }, [messages]);

  // Wrapped send message with callbacks
  const sendMessage = useCallback(
    async (message: string) => {
      if (!message.trim()) return;

      try {
        onMessageSent?.(message);
        await storeSendMessage(message);
        onStreamComplete?.();
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to send message';
        onError?.(errorMessage);
      }
    },
    [storeSendMessage, onMessageSent, onStreamComplete, onError],
  );

  // Clear conversation
  const clearConversation = useCallback(() => {
    storeClearConversation();
  }, [storeClearConversation]);

  // Load existing conversation
  const loadConversation = useCallback(
    async (id: string) => {
      try {
        await storeLoadConversation(id);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to load conversation';
        onError?.(errorMessage);
      }
    },
    [storeLoadConversation, onError],
  );

  // Clear error
  const clearError = useCallback(() => {
    storeSetError(null);
  }, [storeSetError]);

  // Retry last failed message
  const retryLastMessage = useCallback(async () => {
    if (!lastUserMessage) return;

    // Clear error state
    storeSetError(null);

    // Re-send the last user message
    await sendMessage(lastUserMessage);
  }, [lastUserMessage, sendMessage, storeSetError]);

  // Abort streaming
  const abortStream = useCallback(() => {
    storeAbortStream();
  }, [storeAbortStream]);

  // Memoize return object for stable reference
  return useMemo(
    () => ({
      messages,
      isStreaming,
      isLoading,
      error,
      conversationId,
      hasMessages: derivedState.hasMessages,
      lastMessage: derivedState.lastMessage,
      isAssistantTurn: derivedState.isAssistantTurn,
      sendMessage,
      clearConversation,
      loadConversation,
      clearError,
      retryLastMessage,
      abortStream,
    }),
    [
      messages,
      isStreaming,
      isLoading,
      error,
      conversationId,
      derivedState,
      sendMessage,
      clearConversation,
      loadConversation,
      clearError,
      retryLastMessage,
      abortStream,
    ],
  );
}

/**
 * Hook for accessing just the streaming state.
 *
 * Lightweight hook when you only need to know if streaming is active.
 *
 * @returns Whether a response is currently streaming
 */
export function useIsStreaming(): boolean {
  return useAssistantStore(selectIsStreaming);
}

/**
 * Hook for accessing just the conversation ID.
 *
 * Useful for components that need to track the current conversation
 * without subscribing to message updates.
 *
 * @returns The active conversation ID or null
 */
export function useConversationId(): string | null {
  return useAssistantStore(selectConversationId);
}

/**
 * Hook for accessing just the error state.
 *
 * @returns The current error message or null
 */
export function useChatError(): string | null {
  return useAssistantStore(selectError);
}
