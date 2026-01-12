/**
 * Assistant test fixtures and mocks.
 *
 * Provides mock API responses for testing the assistant chat flow.
 */

import type { Page, Route } from '@playwright/test';

// =============================================================================
// Test Data
// =============================================================================

export const TEST_CONVERSATION = {
  id: 'conv-test-123',
  title: null,
  status: 'active',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
} as const;

export const TEST_TASK = {
  id: 'task-test-456',
  title: 'Test task from assistant',
  status: 'pending',
  priority: 'medium',
} as const;

// =============================================================================
// SSE Stream Builders
// =============================================================================

/**
 * Build an SSE stream response for testing.
 */
export function buildSSEStream(chunks: { type: string; [key: string]: unknown }[]): string {
  return chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('');
}

/**
 * Build a simple text response stream.
 */
export function buildTextResponseStream(text: string): string {
  // Split text into words for realistic streaming
  const words = text.split(' ');
  const chunks: { type: string; [key: string]: unknown }[] = words.map((word, i) => ({
    type: 'content',
    content: i === 0 ? word : ` ${word}`,
  }));
  chunks.push({ type: 'done' });
  return buildSSEStream(chunks);
}

/**
 * Build a response stream with a tool call.
 */
export function buildToolCallResponseStream(
  toolName: string,
  toolArgs: Record<string, unknown>,
  toolResult: unknown,
  responseText: string,
): string {
  const chunks = [
    { type: 'content', content: 'Let me ' },
    { type: 'content', content: 'help you with that. ' },
    {
      type: 'tool_call',
      toolCall: {
        id: `call_${String(Date.now())}`,
        name: toolName,
        arguments: toolArgs,
      },
    },
    { type: 'content', content: responseText },
    {
      type: 'done',
      fullResponse: {
        content: `Let me help you with that. ${responseText}`,
        toolCalls: [
          {
            id: `call_${String(Date.now())}`,
            name: toolName,
            arguments: toolArgs,
          },
        ],
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        model: 'gpt-4',
        finishReason: 'stop',
      },
    },
  ];
  return buildSSEStream(chunks);
}

// =============================================================================
// Route Handlers
// =============================================================================

/**
 * Mock the conversation creation endpoint.
 */
export async function mockConversationCreate(page: Page): Promise<void> {
  await page.route('**/api/ai/conversations', async (route: Route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ conversationId: TEST_CONVERSATION.id }),
      });
    } else {
      await route.continue();
    }
  });
}

/**
 * Mock the chat stream endpoint with a simple text response.
 */
export async function mockChatStreamSimple(page: Page, responseText: string): Promise<void> {
  await page.route('**/api/ai/chat/stream', async (route: Route) => {
    const stream = buildTextResponseStream(responseText);
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: {
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
      body: stream,
    });
  });
}

/**
 * Mock the chat stream endpoint with a tool call response.
 */
export async function mockChatStreamWithToolCall(
  page: Page,
  toolName: string,
  toolArgs: Record<string, unknown>,
  toolResult: unknown,
  responseText: string,
): Promise<void> {
  await page.route('**/api/ai/chat/stream', async (route: Route) => {
    const stream = buildToolCallResponseStream(toolName, toolArgs, toolResult, responseText);
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: {
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
      body: stream,
    });
  });
}

/**
 * Mock the chat stream endpoint to return an error.
 */
export async function mockChatStreamError(page: Page, errorMessage: string): Promise<void> {
  await page.route('**/api/ai/chat/stream', async (route: Route) => {
    const stream = buildSSEStream([{ type: 'error', error: errorMessage }]);
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: stream,
    });
  });
}

/**
 * Mock the chat stream endpoint to fail with HTTP error.
 */
export async function mockChatStreamHttpError(page: Page, status: number): Promise<void> {
  await page.route('**/api/ai/chat/stream', async (route: Route) => {
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Request failed' }),
    });
  });
}

/**
 * Set up all assistant API mocks for a successful flow.
 */
export async function setupAssistantMocks(page: Page, responseText: string): Promise<void> {
  await mockConversationCreate(page);
  await mockChatStreamSimple(page, responseText);
}

/**
 * Set up assistant mocks with tool call.
 */
export async function setupAssistantMocksWithTool(
  page: Page,
  toolName: string,
  toolArgs: Record<string, unknown>,
  toolResult: unknown,
  responseText: string,
): Promise<void> {
  await mockConversationCreate(page);
  await mockChatStreamWithToolCall(page, toolName, toolArgs, toolResult, responseText);
}

// =============================================================================
// URL Constants
// =============================================================================

export const ASSISTANT_URLS = {
  FULL_PAGE: '/assistant',
} as const;

// =============================================================================
// Selectors
// =============================================================================

export const ASSISTANT_SELECTORS = {
  // Command palette
  COMMAND_PALETTE: '[role="dialog"]',
  COMMAND_INPUT: '[role="combobox"]',
  TALK_TO_ATHENA: 'Talk to Athena',
  ASSISTANT_HINT: 'Press Enter to ask Athena',

  // Assistant UI
  ASSISTANT_HEADER: 'Athena',
  MESSAGE_LOG: '[role="log"]',
  MESSAGE_INPUT: 'textarea',
  SEND_BUTTON: 'button[type="submit"]',
  EXPAND_BUTTON: '[aria-label="Expand to full view"]',
  BACK_BUTTON: '[aria-label="Back to commands"]',

  // Message states
  THINKING_INDICATOR: 'thinking...',
  ERROR_BANNER: '[role="alert"]',
  RETRY_BUTTON: 'Retry',
} as const;
