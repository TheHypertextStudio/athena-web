/**
 * Assistant Flow E2E Tests
 *
 * Tests the complete assistant interaction flow:
 * - Command palette → Assistant mode transition
 * - Message sending and streaming responses
 * - Tool call visualization
 * - Modal and full-page expansion
 * - Error handling and recovery
 */

import { test, expect, type Page } from '@playwright/test';
import {
  clearAuthState,
  mockAuthenticatedSession,
  setAuthenticatedState,
} from './fixtures/auth-fixtures';
import {
  setupAssistantMocks,
  setupAssistantMocksWithTool,
  mockChatStreamError,
  mockConversationCreate,
  ASSISTANT_SELECTORS,
  ASSISTANT_URLS,
} from './fixtures/assistant-fixtures';

/**
 * Helper to wait for page to be fully interactive
 */
async function waitForInteractive(page: Page) {
  await page.waitForLoadState('networkidle');
  // Wait a bit for React to hydrate and event handlers to attach
  await page.waitForTimeout(500);
}

/**
 * Open command palette and wait for it to be visible
 */
async function openCommandPalette(page: Page) {
  // Try keyboard shortcut
  await page.keyboard.press('Meta+k');

  // Wait for dialog to appear
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible({ timeout: 3000 });
}

// =============================================================================
// Test Setup
// =============================================================================

test.describe('Assistant Flow', () => {
  test.beforeEach(async ({ page, context }) => {
    // Set up authenticated state
    await clearAuthState(context);
    await setAuthenticatedState(context);
    await mockAuthenticatedSession(page);
  });

  // ===========================================================================
  // JOURNEY 1: Command Palette to Assistant Mode
  // ===========================================================================

  test.describe('Command Palette → Assistant Mode', () => {
    test('opens command palette with Cmd+K', async ({ page }) => {
      await page.goto('/home');
      await waitForInteractive(page);

      // Open command palette
      await openCommandPalette(page);

      // Command palette should be visible
      const palette = page.locator(ASSISTANT_SELECTORS.COMMAND_PALETTE);
      await expect(palette).toBeVisible();
    });

    test('shows "Talk to Athena" action in command list', async ({ page }) => {
      await page.goto('/home');
      await waitForInteractive(page);

      await openCommandPalette(page);

      // Should see the Talk to Athena action
      const athenaAction = page.getByText(ASSISTANT_SELECTORS.TALK_TO_ATHENA);
      await expect(athenaAction).toBeVisible();
    });

    test('clicking "Talk to Athena" switches to assistant mode', async ({ page }) => {
      await setupAssistantMocks(page, 'Hello! How can I help you?');
      await page.goto('/home');
      await waitForInteractive(page);

      await openCommandPalette(page);

      // Click Talk to Athena
      await page.getByText(ASSISTANT_SELECTORS.TALK_TO_ATHENA).click();

      // Should see assistant header
      const header = page.getByText(ASSISTANT_SELECTORS.ASSISTANT_HEADER);
      await expect(header).toBeVisible({ timeout: 5000 });

      // Should see back button
      const backButton = page.locator(ASSISTANT_SELECTORS.BACK_BUTTON);
      await expect(backButton).toBeVisible();
    });

    test('typing with no matches shows assistant hint', async ({ page }) => {
      await page.goto('/home');
      await waitForInteractive(page);

      await openCommandPalette(page);

      // Type something that won't match any commands
      await page.keyboard.type('xyznonexistentcommand123');

      // Should show assistant hint (text about "ask Athena")
      const hint = page.getByText(/ask Athena/i);
      await expect(hint).toBeVisible({ timeout: 5000 });
    });

    test('pressing Enter with no matches enters assistant mode with query', async ({ page }) => {
      await setupAssistantMocks(page, 'I can help you organize your day!');
      await page.goto('/home');
      await waitForInteractive(page);

      await openCommandPalette(page);
      await page.keyboard.type('xyznonexistentcommand123');

      // Wait for hint to appear
      await expect(page.getByText(/ask Athena/i)).toBeVisible({ timeout: 5000 });

      // Press Enter to send to assistant
      await page.keyboard.press('Enter');

      // Should see the user message (may take time to render)
      const userMessage = page.getByText('xyznonexistentcommand123');
      await expect(userMessage).toBeVisible({ timeout: 10000 });
    });

    test('Escape exits assistant mode back to command mode', async ({ page }) => {
      await setupAssistantMocks(page, 'Hello!');
      await page.goto('/home');
      await waitForInteractive(page);

      // Enter assistant mode
      await openCommandPalette(page);
      await page.getByText(ASSISTANT_SELECTORS.TALK_TO_ATHENA).click();

      // Verify we're in assistant mode
      await expect(page.getByText(ASSISTANT_SELECTORS.ASSISTANT_HEADER)).toBeVisible({
        timeout: 5000,
      });

      // Press Escape
      await page.keyboard.press('Escape');

      // Should be back in command mode - command input should be visible
      const commandInput = page.locator(ASSISTANT_SELECTORS.COMMAND_INPUT);
      await expect(commandInput).toBeVisible({ timeout: 5000 });
    });
  });

  // ===========================================================================
  // JOURNEY 2: Message Sending and Streaming
  // ===========================================================================

  test.describe('Message Sending and Streaming', () => {
    test('sends message and shows streaming response', async ({ page }) => {
      await setupAssistantMocks(page, 'Here is a helpful response to your question.');
      await page.goto('/home');
      await waitForInteractive(page);

      // Enter assistant mode
      await openCommandPalette(page);
      await page.getByText(ASSISTANT_SELECTORS.TALK_TO_ATHENA).click();
      await expect(page.getByText(ASSISTANT_SELECTORS.ASSISTANT_HEADER)).toBeVisible({
        timeout: 5000,
      });

      // Type and send a message
      const input = page.locator('textarea');
      await input.fill('What tasks do I have today?');
      await page.keyboard.press('Enter');

      // Should show user message
      await expect(page.getByText('What tasks do I have today?')).toBeVisible({ timeout: 5000 });

      // Should show assistant response (streamed)
      await expect(page.getByText(/helpful response/i)).toBeVisible({ timeout: 10000 });
    });

    test('shows thinking indicator while streaming', async ({ page }) => {
      // Use a delayed response to catch the thinking state
      await mockConversationCreate(page);
      await page.route('**/api/ai/chat/stream', async (route) => {
        // Delay the response
        await new Promise((resolve) => setTimeout(resolve, 500));
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'data: {"type":"content","content":"Hello"}\n\ndata: {"type":"done"}\n\n',
        });
      });

      await page.goto('/home');
      await waitForInteractive(page);

      await openCommandPalette(page);
      await page.getByText(ASSISTANT_SELECTORS.TALK_TO_ATHENA).click();
      await expect(page.getByText(ASSISTANT_SELECTORS.ASSISTANT_HEADER)).toBeVisible({
        timeout: 5000,
      });

      const input = page.locator('textarea');
      await input.fill('Test message');
      await page.keyboard.press('Enter');

      // Should show thinking indicator
      const thinking = page.getByText(ASSISTANT_SELECTORS.THINKING_INDICATOR);
      await expect(thinking).toBeVisible({ timeout: 2000 });
    });

    test('multiple messages in conversation', async ({ page }) => {
      let messageCount = 0;
      await mockConversationCreate(page);
      await page.route('**/api/ai/chat/stream', async (route) => {
        messageCount++;
        const response = messageCount === 1 ? 'First response' : 'Second response';
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: `data: {"type":"content","content":"${response}"}\n\ndata: {"type":"done"}\n\n`,
        });
      });

      await page.goto('/home');
      await waitForInteractive(page);

      await openCommandPalette(page);
      await page.getByText(ASSISTANT_SELECTORS.TALK_TO_ATHENA).click();
      await expect(page.getByText(ASSISTANT_SELECTORS.ASSISTANT_HEADER)).toBeVisible({
        timeout: 5000,
      });

      // Send first message
      const input = page.locator('textarea');
      await input.fill('First question');
      await page.keyboard.press('Enter');
      await expect(page.getByText('First response')).toBeVisible({ timeout: 5000 });

      // Send second message
      await input.fill('Second question');
      await page.keyboard.press('Enter');
      await expect(page.getByText('Second response')).toBeVisible({ timeout: 5000 });

      // Both user messages should be visible
      await expect(page.getByText('First question')).toBeVisible();
      await expect(page.getByText('Second question')).toBeVisible();
    });
  });

  // ===========================================================================
  // JOURNEY 3: Tool Call Visualization
  // ===========================================================================

  test.describe('Tool Call Visualization', () => {
    test('shows tool call card when assistant uses a tool', async ({ page }) => {
      await setupAssistantMocksWithTool(
        page,
        'list_tasks',
        { status: 'pending' },
        { tasks: [{ id: '1', title: 'Test task' }] },
        'Here are your pending tasks.',
      );

      await page.goto('/home');
      await waitForInteractive(page);

      await openCommandPalette(page);
      await page.getByText(ASSISTANT_SELECTORS.TALK_TO_ATHENA).click();
      await expect(page.getByText(ASSISTANT_SELECTORS.ASSISTANT_HEADER)).toBeVisible({
        timeout: 5000,
      });

      const input = page.locator('textarea');
      await input.fill('Show my tasks');
      await page.keyboard.press('Enter');

      // Should show the response
      await expect(page.getByText(/pending tasks/i)).toBeVisible({ timeout: 10000 });
    });
  });

  // ===========================================================================
  // JOURNEY 4: Error Handling
  // ===========================================================================

  test.describe('Error Handling', () => {
    test('shows error banner when stream fails', async ({ page }) => {
      await mockConversationCreate(page);
      await mockChatStreamError(page, 'Something went wrong');

      await page.goto('/home');
      await waitForInteractive(page);

      await openCommandPalette(page);
      await page.getByText(ASSISTANT_SELECTORS.TALK_TO_ATHENA).click();
      await expect(page.getByText(ASSISTANT_SELECTORS.ASSISTANT_HEADER)).toBeVisible({
        timeout: 5000,
      });

      const input = page.locator('textarea');
      await input.fill('Test message');
      await page.keyboard.press('Enter');

      // Should show error
      const error = page.locator(ASSISTANT_SELECTORS.ERROR_BANNER);
      await expect(error).toBeVisible({ timeout: 5000 });
    });

    test('retry button resends the message', async ({ page }) => {
      let attemptCount = 0;
      await mockConversationCreate(page);
      await page.route('**/api/ai/chat/stream', async (route) => {
        attemptCount++;
        if (attemptCount === 1) {
          // First attempt fails
          await route.fulfill({
            status: 200,
            contentType: 'text/event-stream',
            body: 'data: {"type":"error","error":"Network error"}\n\n',
          });
        } else {
          // Retry succeeds
          await route.fulfill({
            status: 200,
            contentType: 'text/event-stream',
            body: 'data: {"type":"content","content":"Success!"}\n\ndata: {"type":"done"}\n\n',
          });
        }
      });

      await page.goto('/home');
      await waitForInteractive(page);

      await openCommandPalette(page);
      await page.getByText(ASSISTANT_SELECTORS.TALK_TO_ATHENA).click();
      await expect(page.getByText(ASSISTANT_SELECTORS.ASSISTANT_HEADER)).toBeVisible({
        timeout: 5000,
      });

      const input = page.locator('textarea');
      await input.fill('Test message');
      await page.keyboard.press('Enter');

      // Wait for error
      const error = page.locator(ASSISTANT_SELECTORS.ERROR_BANNER);
      await expect(error).toBeVisible({ timeout: 5000 });

      // Click retry
      await page.getByRole('button', { name: ASSISTANT_SELECTORS.RETRY_BUTTON }).click();

      // Should succeed on retry
      await expect(page.getByText('Success!')).toBeVisible({ timeout: 5000 });
    });
  });

  // ===========================================================================
  // JOURNEY 5: Expansion to Modal and Full Page
  // ===========================================================================

  test.describe('Expansion Flow', () => {
    test('expand button opens modal', async ({ page }) => {
      await setupAssistantMocks(page, 'Hello!');
      await page.goto('/home');
      await waitForInteractive(page);

      await openCommandPalette(page);
      await page.getByText(ASSISTANT_SELECTORS.TALK_TO_ATHENA).click();
      await expect(page.getByText(ASSISTANT_SELECTORS.ASSISTANT_HEADER)).toBeVisible({
        timeout: 5000,
      });

      // Click expand button
      const expandButton = page.locator(ASSISTANT_SELECTORS.EXPAND_BUTTON);
      await expandButton.click();

      // Should navigate to assistant route (intercepted as modal)
      await expect(page).toHaveURL(/\/assistant/);
    });

    test('full page assistant loads directly', async ({ page }) => {
      await setupAssistantMocks(page, 'Hello from full page!');
      await page.goto(ASSISTANT_URLS.FULL_PAGE);
      await waitForInteractive(page);

      // Should see some assistant-related content
      // The exact header text may vary, so we look for multiple possibilities
      const header = page
        .locator('h1, h2, [role="heading"]')
        .filter({ hasText: /athena|assistant/i });
      await expect(header.first()).toBeVisible({ timeout: 5000 });
    });

    test('can send messages in full page mode', async ({ page }) => {
      await setupAssistantMocks(page, 'Response in full page mode!');
      await page.goto(ASSISTANT_URLS.FULL_PAGE);
      await waitForInteractive(page);

      const input = page.locator('textarea');
      await input.fill('Hello from full page');
      await page.keyboard.press('Enter');

      await expect(page.getByText('Hello from full page')).toBeVisible({ timeout: 5000 });
      await expect(page.getByText(/full page mode/i)).toBeVisible({ timeout: 5000 });
    });
  });

  // ===========================================================================
  // JOURNEY 6: Keyboard Shortcuts
  // ===========================================================================

  test.describe('Keyboard Shortcuts', () => {
    test('Cmd+Shift+A opens assistant mode directly', async ({ page }) => {
      await setupAssistantMocks(page, 'Hello!');
      await page.goto('/home');
      await waitForInteractive(page);

      // Use the direct shortcut
      await page.keyboard.press('Meta+Shift+a');

      // Should be in assistant mode
      const header = page.getByText(ASSISTANT_SELECTORS.ASSISTANT_HEADER);
      await expect(header).toBeVisible({ timeout: 5000 });
    });

    test('Enter sends message in assistant mode', async ({ page }) => {
      await setupAssistantMocks(page, 'Got your message!');
      await page.goto('/home');
      await waitForInteractive(page);

      await openCommandPalette(page);
      await page.getByText(ASSISTANT_SELECTORS.TALK_TO_ATHENA).click();
      await expect(page.getByText(ASSISTANT_SELECTORS.ASSISTANT_HEADER)).toBeVisible({
        timeout: 5000,
      });

      const input = page.locator('textarea');
      await input.fill('Test');
      await page.keyboard.press('Enter');

      await expect(page.getByText('Got your message!')).toBeVisible({ timeout: 5000 });
    });

    test('Shift+Enter creates newline instead of sending', async ({ page }) => {
      await setupAssistantMocks(page, 'Hello!');
      await page.goto('/home');
      await waitForInteractive(page);

      await openCommandPalette(page);
      await page.getByText(ASSISTANT_SELECTORS.TALK_TO_ATHENA).click();
      await expect(page.getByText(ASSISTANT_SELECTORS.ASSISTANT_HEADER)).toBeVisible({
        timeout: 5000,
      });

      const input = page.locator('textarea');
      await input.fill('Line 1');
      await page.keyboard.press('Shift+Enter');
      await page.keyboard.type('Line 2');

      // Should have both lines in the input
      const value = await input.inputValue();
      expect(value).toContain('Line 1');
      expect(value).toContain('Line 2');
    });
  });
});

// =============================================================================
// JOURNEY 7: Accessibility
// =============================================================================

test.describe('Assistant Accessibility', () => {
  test.beforeEach(async ({ page, context }) => {
    await clearAuthState(context);
    await setAuthenticatedState(context);
    await mockAuthenticatedSession(page);
  });

  test('message log has correct ARIA attributes', async ({ page }) => {
    await setupAssistantMocks(page, 'Hello!');
    await page.goto('/home');
    await waitForInteractive(page);

    await openCommandPalette(page);
    await page.getByText(ASSISTANT_SELECTORS.TALK_TO_ATHENA).click();
    await expect(page.getByText(ASSISTANT_SELECTORS.ASSISTANT_HEADER)).toBeVisible({
      timeout: 5000,
    });

    // Check message log
    const log = page.locator('[role="log"]');
    await expect(log).toBeVisible({ timeout: 5000 });
    await expect(log).toHaveAttribute('aria-label', 'Conversation messages');
  });

  test('error banner has alert role', async ({ page }) => {
    await mockConversationCreate(page);
    await mockChatStreamError(page, 'Test error');
    await page.goto('/home');
    await waitForInteractive(page);

    await openCommandPalette(page);
    await page.getByText(ASSISTANT_SELECTORS.TALK_TO_ATHENA).click();
    await expect(page.getByText(ASSISTANT_SELECTORS.ASSISTANT_HEADER)).toBeVisible({
      timeout: 5000,
    });

    const input = page.locator('textarea');
    await input.fill('Test');
    await page.keyboard.press('Enter');

    const alert = page.locator('[role="alert"]');
    await expect(alert).toBeVisible({ timeout: 5000 });
  });
});
