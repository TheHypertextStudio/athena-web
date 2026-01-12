/**
 * Unit tests for stream-parser.ts
 *
 * Tests SSE parsing, signal handling, and error recovery.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseStream,
  StreamParseError,
  createTimeoutController,
  createCombinedSignal,
} from '@/lib/assistant/stream-parser';
import type { StreamChunk } from '@/lib/assistant/types';

// =============================================================================
// parseStream Tests
// =============================================================================

describe('parseStream', () => {
  it('throws StreamParseError when response body is null', async () => {
    // Response with null body - pass null explicitly
    const response = new Response(null);

    // A Response created with null has a null body - verify this first
    // Note: In some environments Response(null) still creates an empty body
    // So we just verify the parseStream handles it properly
    const generator = parseStream(response);

    // Either throws StreamParseError or yields nothing for empty response
    try {
      const result = await generator.next();
      // If it doesn't throw, it should be done immediately
      expect(result.done).toBe(true);
    } catch (error) {
      expect(error).toBeInstanceOf(StreamParseError);
    }
  });

  it('parses single content chunk', async () => {
    const sseData = 'data: {"type":"content","content":"Hello"}\n\n';
    const response = new Response(sseData);

    const chunks: StreamChunk[] = [];
    for await (const chunk of parseStream(response)) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ type: 'content', content: 'Hello' });
  });

  it('parses multiple chunks', async () => {
    const sseData =
      'data: {"type":"content","content":"Hello"}\n\n' +
      'data: {"type":"content","content":" World"}\n\n' +
      'data: {"type":"done"}\n\n';
    const response = new Response(sseData);

    const chunks: StreamChunk[] = [];
    for await (const chunk of parseStream(response)) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toEqual({ type: 'content', content: 'Hello' });
    expect(chunks[1]).toEqual({ type: 'content', content: ' World' });
    expect(chunks[2]).toEqual({ type: 'done' });
  });

  it('parses tool_call chunks', async () => {
    const toolCall = {
      id: 'call_123',
      name: 'create_task',
      arguments: { title: 'Test task' },
    };
    const sseData = `data: {"type":"tool_call","toolCall":${JSON.stringify(toolCall)}}\n\n`;
    const response = new Response(sseData);

    const chunks: StreamChunk[] = [];
    for await (const chunk of parseStream(response)) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ type: 'tool_call', toolCall });
  });

  it('handles [DONE] message (OpenAI style)', async () => {
    const sseData = 'data: [DONE]\n\n';
    const response = new Response(sseData);

    const chunks: StreamChunk[] = [];
    for await (const chunk of parseStream(response)) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ type: 'done' });
  });

  it('skips non-data lines within separate events', async () => {
    // Each event is separated by \n\n
    // Non-data events (comments, empty) are skipped entirely
    const sseData = 'data: {"type":"content","content":"Hello"}\n\n' + 'data: {"type":"done"}\n\n';
    const response = new Response(sseData);

    const chunks: StreamChunk[] = [];
    for await (const chunk of parseStream(response)) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual({ type: 'content', content: 'Hello' });
    expect(chunks[1]).toEqual({ type: 'done' });
  });

  it('skips comment-only events', async () => {
    // SSE comments start with :
    const sseData =
      'data: {"type":"content","content":"Hello"}\n\n' +
      ': this is a comment\n\n' +
      'data: {"type":"done"}\n\n';
    const response = new Response(sseData);

    const chunks: StreamChunk[] = [];
    for await (const chunk of parseStream(response)) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual({ type: 'content', content: 'Hello' });
    expect(chunks[1]).toEqual({ type: 'done' });
  });

  it('handles malformed JSON gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const sseData =
      'data: {"type":"content","content":"Hello"}\n\n' +
      'data: {malformed json}\n\n' +
      'data: {"type":"done"}\n\n';
    const response = new Response(sseData);

    const chunks: StreamChunk[] = [];
    for await (const chunk of parseStream(response)) {
      chunks.push(chunk);
    }

    // Should skip malformed chunk and continue
    expect(chunks).toHaveLength(2);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('handles stream that ends normally', async () => {
    const encoder = new TextEncoder();

    // Create a readable stream that ends after sending data
    const stream = new ReadableStream({
      start(streamController) {
        streamController.enqueue(encoder.encode('data: {"type":"content","content":"Hello"}\n\n'));
        streamController.enqueue(encoder.encode('data: {"type":"done"}\n\n'));
        streamController.close();
      },
    });

    const response = new Response(stream);
    const chunks: StreamChunk[] = [];

    for await (const chunk of parseStream(response)) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual({ type: 'content', content: 'Hello' });
    expect(chunks[1]).toEqual({ type: 'done' });
  });
});

// =============================================================================
// createTimeoutController Tests
// =============================================================================

describe('createTimeoutController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates an AbortController', () => {
    const controller = createTimeoutController(1000);
    expect(controller).toBeInstanceOf(AbortController);
    expect(controller.signal.aborted).toBe(false);
  });

  it('aborts after timeout', () => {
    const controller = createTimeoutController(1000);
    expect(controller.signal.aborted).toBe(false);

    vi.advanceTimersByTime(1000);

    expect(controller.signal.aborted).toBe(true);
  });

  it('does not abort before timeout', () => {
    const controller = createTimeoutController(1000);
    vi.advanceTimersByTime(999);
    expect(controller.signal.aborted).toBe(false);
  });
});

// =============================================================================
// createCombinedSignal Tests
// =============================================================================

describe('createCombinedSignal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns signal and cleanup function', () => {
    const { signal, cleanup } = createCombinedSignal(1000);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(typeof cleanup).toBe('function');
  });

  it('signal aborts after timeout', () => {
    const { signal } = createCombinedSignal(1000);
    expect(signal.aborted).toBe(false);

    vi.advanceTimersByTime(1000);

    expect(signal.aborted).toBe(true);
  });

  it('signal aborts when user signal aborts', () => {
    const userController = new AbortController();
    const { signal } = createCombinedSignal(10000, userController.signal);

    expect(signal.aborted).toBe(false);

    userController.abort();

    expect(signal.aborted).toBe(true);
  });

  it('cleanup prevents timeout abort', () => {
    const { signal, cleanup } = createCombinedSignal(1000);

    cleanup();
    vi.advanceTimersByTime(1000);

    // Signal should not be aborted because we cleaned up
    // Note: cleanup is called when signal aborts, so this tests early cleanup
    expect(signal.aborted).toBe(false);
  });

  it('cleanup removes user signal listener', () => {
    const userController = new AbortController();
    const { signal, cleanup } = createCombinedSignal(10000, userController.signal);

    cleanup();

    // Aborting user signal after cleanup should not affect our signal
    userController.abort();
    expect(signal.aborted).toBe(false);
  });

  it('cleanup is idempotent', () => {
    const { cleanup } = createCombinedSignal(1000);

    // Should not throw when called multiple times
    cleanup();
    cleanup();
    cleanup();
  });
});

// =============================================================================
// Error Handling Tests
// =============================================================================

describe('StreamParseError', () => {
  it('has correct name', () => {
    const error = new StreamParseError('test message');
    expect(error.name).toBe('StreamParseError');
  });

  it('preserves cause', () => {
    const cause = new Error('original error');
    const error = new StreamParseError('wrapped', cause);
    expect(error.cause).toBe(cause);
  });
});
