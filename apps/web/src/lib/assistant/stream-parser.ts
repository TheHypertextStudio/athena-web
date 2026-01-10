/**
 * SSE stream parser for the AI chat endpoint.
 *
 * Parses Server-Sent Events from `/api/ai/chat/stream` and yields
 * typed StreamChunk objects for consumption by the UI.
 *
 * @packageDocumentation
 */

import type { StreamChunk } from './types';

/**
 * Error thrown when stream parsing fails.
 */
export class StreamParseError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'StreamParseError';
  }
}

/**
 * Parse an SSE stream from a Response object.
 *
 * Yields StreamChunk objects as they arrive from the server.
 * Handles connection errors, malformed data, and incomplete chunks.
 *
 * @param response - The fetch Response with an SSE body
 * @yields StreamChunk objects parsed from the stream
 * @throws StreamParseError if the stream cannot be read
 *
 * @example
 * ```typescript
 * const response = await fetch('/api/ai/chat/stream', { ... });
 * for await (const chunk of parseStream(response)) {
 *   if (chunk.type === 'content') {
 *     console.log(chunk.content);
 *   }
 * }
 * ```
 */
export async function* parseStream(response: Response): AsyncGenerator<StreamChunk> {
  if (!response.body) {
    throw new StreamParseError('Response body is null');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- infinite stream loop
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        // Process any remaining buffer
        if (buffer.trim()) {
          const chunk = parseSSELine(buffer);
          if (chunk) yield chunk;
        }
        break;
      }

      // Decode the chunk and add to buffer
      buffer += decoder.decode(value, { stream: true });

      // Split on double newlines (SSE event separator)
      const events = buffer.split('\n\n');

      // Keep the last (potentially incomplete) event in the buffer
      buffer = events.pop() ?? '';

      // Process complete events
      for (const event of events) {
        const chunk = parseSSELine(event);
        if (chunk) {
          yield chunk;
        }
      }
    }
  } catch (error) {
    // Check if this is an abort error (user cancelled)
    if (error instanceof DOMException && error.name === 'AbortError') {
      // Yield an error chunk for abort
      yield {
        type: 'error',
        error: 'Stream was cancelled',
      };
      return;
    }

    throw new StreamParseError('Failed to read stream', error);
  } finally {
    reader.releaseLock();
  }
}

/**
 * Parse a single SSE event line.
 *
 * SSE format: `data: <json>\n\n`
 * May also contain `event:` and `id:` lines which we ignore.
 *
 * @param line - The raw SSE event text
 * @returns Parsed StreamChunk or null if not a data line
 */
function parseSSELine(line: string): StreamChunk | null {
  const trimmed = line.trim();

  // Skip empty lines and non-data lines (empty check is for empty string)
  // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- checking empty string separately
  if (!trimmed || !trimmed.startsWith('data:')) {
    return null;
  }

  // Extract JSON after "data: "
  const jsonStr = trimmed.slice(5).trim();

  // Handle special "data: [DONE]" message (OpenAI style)
  if (jsonStr === '[DONE]') {
    return { type: 'done' };
  }

  try {
    return JSON.parse(jsonStr) as StreamChunk;
  } catch {
    console.warn('[stream-parser] Failed to parse SSE data:', jsonStr);
    return null;
  }
}

/**
 * Create an AbortController with a timeout.
 *
 * Useful for setting a maximum stream duration.
 *
 * @param timeoutMs - Timeout in milliseconds
 * @returns AbortController that will abort after the timeout
 *
 * @example
 * ```typescript
 * const controller = createTimeoutController(30000); // 30 seconds
 * const response = await fetch(url, { signal: controller.signal });
 * ```
 */
export function createTimeoutController(timeoutMs: number): AbortController {
  const controller = new AbortController();

  setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  return controller;
}

/**
 * Result of creating a combined abort signal.
 */
export interface CombinedSignalResult {
  /** The combined AbortSignal */
  signal: AbortSignal;
  /** Cleanup function to remove event listeners and clear timeout */
  cleanup: () => void;
}

/**
 * Merge an optional user AbortSignal with a timeout.
 *
 * Creates a combined signal that aborts when either:
 * - The user signal aborts
 * - The timeout is reached
 *
 * IMPORTANT: Call cleanup() when done to prevent memory leaks.
 *
 * @param timeoutMs - Timeout in milliseconds
 * @param userSignal - Optional user-provided AbortSignal
 * @returns Combined signal and cleanup function
 */
export function createCombinedSignal(
  timeoutMs: number,
  userSignal?: AbortSignal,
): CombinedSignalResult {
  const controller = new AbortController();
  let isCleanedUp = false;

  // Set up timeout
  const timeoutId = setTimeout(() => {
    if (!isCleanedUp) {
      controller.abort(new DOMException('Stream timeout', 'TimeoutError'));
    }
  }, timeoutMs);

  // Handler for user signal abort
  const userAbortHandler = () => {
    if (!isCleanedUp) {
      clearTimeout(timeoutId);
      controller.abort(userSignal?.reason);
    }
  };

  // If user signal aborts, abort our controller too
  if (userSignal) {
    userSignal.addEventListener('abort', userAbortHandler);
  }

  // Cleanup function to prevent memory leaks
  const cleanup = () => {
    if (isCleanedUp) return;
    isCleanedUp = true;
    clearTimeout(timeoutId);
    if (userSignal) {
      userSignal.removeEventListener('abort', userAbortHandler);
    }
  };

  // Auto-cleanup when our signal aborts
  controller.signal.addEventListener('abort', cleanup, { once: true });

  return { signal: controller.signal, cleanup };
}

/**
 * Stream chat from the AI endpoint.
 *
 * High-level helper that handles the full request/response cycle.
 *
 * @param conversationId - The conversation to send the message to
 * @param message - The user's message
 * @param options - Optional configuration
 * @returns AsyncGenerator yielding StreamChunks
 *
 * @example
 * ```typescript
 * for await (const chunk of streamChat(conversationId, message)) {
 *   switch (chunk.type) {
 *     case 'content':
 *       appendToMessage(chunk.content);
 *       break;
 *     case 'tool_call':
 *       showToolExecution(chunk.toolCall);
 *       break;
 *     case 'done':
 *       finalizeMessage();
 *       break;
 *     case 'error':
 *       showError(chunk.error);
 *       break;
 *   }
 * }
 * ```
 */
export async function* streamChat(
  conversationId: string,
  message: string,
  options?: {
    /** AbortSignal to cancel the request */
    signal?: AbortSignal;
    /** Timeout in milliseconds (default: 60000) */
    timeoutMs?: number;
    /** Provider override */
    provider?: string;
    /** Temperature override */
    temperature?: number;
  },
): AsyncGenerator<StreamChunk> {
  const { signal, timeoutMs = 60000, provider, temperature } = options ?? {};

  // Create combined signal with timeout (includes cleanup for memory leak prevention)
  const { signal: combinedSignal, cleanup } = createCombinedSignal(timeoutMs, signal);

  try {
    const response = await fetch('/api/ai/chat/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        conversationId,
        message,
        ...(provider && { provider }),
        ...(temperature !== undefined && { temperature }),
      }),
      signal: combinedSignal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      yield {
        type: 'error',
        error: `Request failed: ${String(response.status)} ${errorText}`,
      };
      return;
    }

    yield* parseStream(response);
  } catch (error) {
    if (error instanceof DOMException) {
      if (error.name === 'AbortError') {
        yield { type: 'error', error: 'Request was cancelled' };
      } else if (error.name === 'TimeoutError') {
        yield { type: 'error', error: 'Request timed out' };
      } else {
        yield { type: 'error', error: error.message };
      }
    } else if (error instanceof Error) {
      yield { type: 'error', error: error.message };
    } else {
      yield { type: 'error', error: 'An unknown error occurred' };
    }
  } finally {
    // Clean up event listeners and timeout to prevent memory leaks
    cleanup();
  }
}
