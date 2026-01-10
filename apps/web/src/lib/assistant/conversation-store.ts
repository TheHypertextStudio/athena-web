/**
 * Zustand store for assistant conversation state.
 *
 * Manages conversation state across all assistant surfaces (inline, modal, full page).
 * Handles streaming state, tool calls, and object extraction.
 *
 * @packageDocumentation
 */

import { create } from 'zustand';
import { streamChat } from './stream-parser';
import { extractObjectsFromToolResult } from './object-extractor';
import type {
  AssistantStore,
  AssistantMessage,
  ToolCall,
  ToolCallState,
  ToolCallStatus,
  StreamChunk,
} from './types';

/**
 * Generate a unique ID for messages.
 */
function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Current abort controller for the active stream.
 * Used to cancel in-progress requests.
 */
let currentAbortController: AbortController | null = null;

/**
 * Create the assistant store.
 */
export const useAssistantStore = create<AssistantStore>((set, get) => ({
  // ==========================================================================
  // State
  // ==========================================================================

  activeConversationId: null,
  messages: [],
  isStreaming: false,
  streamingMessageId: null,
  error: null,
  isLoadingConversation: false,

  // ==========================================================================
  // Actions
  // ==========================================================================

  /**
   * Create a new conversation via the API.
   */
  createConversation: async () => {
    try {
      const response = await fetch('/api/ai/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to create conversation');
      }

      const { data } = (await response.json()) as { data: { id: string } };

      set({
        activeConversationId: data.id,
        messages: [],
        error: null,
      });

      return data.id;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create conversation';
      set({ error: message });
      throw error;
    }
  },

  /**
   * Load an existing conversation from the API.
   */
  loadConversation: async (id: string) => {
    set({ isLoadingConversation: true, error: null });

    try {
      const response = await fetch(`/api/ai/conversations/${id}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to load conversation');
      }

      const { data } = (await response.json()) as {
        data: {
          id: string;
          messages: {
            id: string;
            role: 'user' | 'assistant';
            content: string;
            createdAt: string;
          }[];
        };
      };

      // Convert API messages to our format
      const messages: AssistantMessage[] = data.messages.map((msg) => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        status: 'complete' as const,
        toolCalls: [],
        createdObjects: [],
        timestamp: new Date(msg.createdAt),
      }));

      set({
        activeConversationId: data.id,
        messages,
        error: null,
        isLoadingConversation: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load conversation';
      set({ error: message, isLoadingConversation: false });
      throw error;
    }
  },

  /**
   * Send a message and stream the response.
   */
  sendMessage: async (message: string) => {
    const state = get();

    // Prevent concurrent sends - abort any existing stream first
    if (state.isStreaming) {
      get().abortStream();
    }

    // Create a new abort controller for this request
    currentAbortController = new AbortController();

    // Create conversation if needed
    const conversationId = state.activeConversationId ?? (await get().createConversation());

    // Add user message
    const _userMessageId = get().addUserMessage(message);

    // Start assistant message
    const assistantMessageId = get().startAssistantMessage();

    try {
      // Stream the response with abort signal
      for await (const chunk of streamChat(conversationId, message, {
        signal: currentAbortController.signal,
      })) {
        // Check if we've been aborted
        if (currentAbortController.signal.aborted) {
          break;
        }
        processStreamChunk(chunk, assistantMessageId, set, get);
      }
    } catch (error) {
      // Don't show error if we were intentionally aborted
      if (currentAbortController.signal.aborted) {
        return;
      }
      const errorMessage = error instanceof Error ? error.message : 'Stream failed';
      get().errorMessage(assistantMessageId, errorMessage);
    } finally {
      currentAbortController = null;
    }
  },

  /**
   * Add a user message optimistically.
   */
  addUserMessage: (content: string) => {
    const id = generateId();
    const message: AssistantMessage = {
      id,
      role: 'user',
      content,
      status: 'complete',
      toolCalls: [],
      createdObjects: [],
      timestamp: new Date(),
    };

    set((state) => ({
      messages: [...state.messages, message],
    }));

    return id;
  },

  /**
   * Start a new streaming assistant message.
   */
  startAssistantMessage: () => {
    const id = generateId();
    const message: AssistantMessage = {
      id,
      role: 'assistant',
      content: '',
      status: 'streaming',
      toolCalls: [],
      createdObjects: [],
      timestamp: new Date(),
    };

    set((state) => ({
      messages: [...state.messages, message],
      isStreaming: true,
      streamingMessageId: id,
    }));

    return id;
  },

  /**
   * Update the content of a streaming message.
   */
  updateStreamingContent: (messageId: string, content: string) => {
    set((state) => ({
      messages: state.messages.map((msg) => (msg.id === messageId ? { ...msg, content } : msg)),
    }));
  },

  /**
   * Add a tool call to a message.
   */
  addToolCall: (messageId: string, toolCall: ToolCall) => {
    const toolCallState: ToolCallState = {
      ...toolCall,
      status: 'running',
    };

    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === messageId ? { ...msg, toolCalls: [...msg.toolCalls, toolCallState] } : msg,
      ),
    }));
  },

  /**
   * Update a tool call's status and result.
   */
  updateToolCallStatus: (
    messageId: string,
    toolCallId: string,
    status: ToolCallStatus,
    result?: unknown,
    error?: string,
  ) => {
    set((state) => ({
      messages: state.messages.map((msg) => {
        if (msg.id !== messageId) return msg;

        const updatedToolCalls = msg.toolCalls.map((tc) => {
          if (tc.id !== toolCallId) return tc;

          const objects =
            status === 'complete' && result
              ? extractObjectsFromToolResult(tc.name, result)
              : tc.objects;

          return { ...tc, status, result, error, objects };
        });

        // Collect all objects from tool calls
        const createdObjects = updatedToolCalls.flatMap((tc) => tc.objects ?? []);

        return { ...msg, toolCalls: updatedToolCalls, createdObjects };
      }),
    }));
  },

  /**
   * Mark a message as complete.
   */
  completeMessage: (messageId: string) => {
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === messageId ? { ...msg, status: 'complete' as const } : msg,
      ),
      isStreaming: false,
      streamingMessageId: null,
    }));
  },

  /**
   * Mark a message as error.
   */
  errorMessage: (messageId: string, error: string) => {
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === messageId
          ? { ...msg, status: 'error' as const, content: msg.content || error }
          : msg,
      ),
      isStreaming: false,
      streamingMessageId: null,
      error,
    }));
  },

  /**
   * Clear the current conversation (for inline mode).
   */
  clearConversation: () => {
    // Abort any in-progress stream
    if (currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
    }

    set({
      activeConversationId: null,
      messages: [],
      isStreaming: false,
      streamingMessageId: null,
      error: null,
      isLoadingConversation: false,
    });
  },

  /**
   * Set error state.
   */
  setError: (error: string | null) => {
    set({ error });
  },

  /**
   * Abort the current stream.
   */
  abortStream: () => {
    if (currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
    }

    const state = get();
    if (state.streamingMessageId) {
      // Mark the streaming message as complete (partial)
      set((s) => ({
        messages: s.messages.map((msg) =>
          msg.id === state.streamingMessageId ? { ...msg, status: 'complete' as const } : msg,
        ),
        isStreaming: false,
        streamingMessageId: null,
      }));
    } else {
      set({
        isStreaming: false,
        streamingMessageId: null,
      });
    }
  },
}));

/**
 * Process a stream chunk and update the store.
 */
function processStreamChunk(
  chunk: StreamChunk,
  messageId: string,
  set: (
    partial: Partial<AssistantStore> | ((state: AssistantStore) => Partial<AssistantStore>),
  ) => void,
  get: () => AssistantStore,
): void {
  switch (chunk.type) {
    case 'content':
      if (chunk.content) {
        // Append content to the message
        set((state) => {
          const message = state.messages.find((m) => m.id === messageId);
          const newContent = (message?.content ?? '') + (chunk.content ?? '');
          return {
            messages: state.messages.map((msg) =>
              msg.id === messageId ? { ...msg, content: newContent } : msg,
            ),
          };
        });
      }
      break;

    case 'tool_call':
      if (chunk.toolCall) {
        get().addToolCall(messageId, chunk.toolCall);
        // Tool calls are handled by the backend, we just show the status
        // When the stream continues with more content, the tool has completed
      }
      break;

    case 'done':
      // Mark all tool calls as complete if they're still running
      set((state) => ({
        messages: state.messages.map((msg) => {
          if (msg.id !== messageId) return msg;

          const updatedToolCalls = msg.toolCalls.map((tc) =>
            tc.status === 'running' ? { ...tc, status: 'complete' as const } : tc,
          );

          return { ...msg, toolCalls: updatedToolCalls };
        }),
      }));

      get().completeMessage(messageId);
      break;

    case 'error':
      get().errorMessage(messageId, chunk.error ?? 'Unknown error');
      break;
  }
}

/**
 * Selector for getting just the messages.
 */
export const selectMessages = (state: AssistantStore) => state.messages;

/**
 * Selector for streaming state.
 */
export const selectIsStreaming = (state: AssistantStore) => state.isStreaming;

/**
 * Selector for error state.
 */
export const selectError = (state: AssistantStore) => state.error;

/**
 * Selector for active conversation ID.
 */
export const selectConversationId = (state: AssistantStore) => state.activeConversationId;

/**
 * Selector for loading state.
 */
export const selectIsLoadingConversation = (state: AssistantStore) => state.isLoadingConversation;
