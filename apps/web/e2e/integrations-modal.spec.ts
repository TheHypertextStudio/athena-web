/**
 * Integrations Modal E2E Tests
 *
 * Tests the integrations detail modal for accessibility compliance.
 * Specifically verifies that DialogTitle is properly set for screen readers.
 */

import { test, expect } from '@playwright/test';
import { mockAuthenticatedSession, setAuthenticatedState } from './fixtures/auth-fixtures';
import {
  startMockApiServer,
  stopMockApiServer,
  type MockApiServer,
} from './fixtures/mock-api-server';

// =============================================================================
// Test Setup
// =============================================================================

let mockApi: MockApiServer;

test.beforeAll(async () => {
  // Start mock API server before all tests
  mockApi = await startMockApiServer(4000);
});

test.afterAll(async () => {
  // Stop mock API server after all tests
  await stopMockApiServer(mockApi);
});

test.describe('Integrations Modal Accessibility', () => {
  test.beforeEach(async ({ page, context }) => {
    // Set up authenticated session
    await setAuthenticatedState(context);
    await mockAuthenticatedSession(page);
  });

  test('integration detail modal has proper DialogTitle for accessibility', async ({ page }) => {
    // Collect console warnings
    const consoleWarnings: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'warning' || msg.type() === 'error') {
        consoleWarnings.push(msg.text());
      }
    });

    // Navigate to integrations settings
    await page.goto('/settings/integrations');
    await page.waitForLoadState('networkidle');

    // Wait for the page content to load
    await page.waitForTimeout(1000);

    // Find and click on an integration card (Linear is first in the list)
    const integrationCard = page.locator('a[href*="/settings/integrations/detail/"]').first();
    await expect(integrationCard).toBeVisible({ timeout: 15000 });
    await integrationCard.click();

    // Wait for the modal dialog to appear
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Give React time to render and log any warnings
    await page.waitForTimeout(1000);

    // Check that no DialogTitle warnings were logged
    const dialogTitleWarnings = consoleWarnings.filter(
      (msg) => msg.includes('DialogContent') && msg.includes('DialogTitle'),
    );

    expect(dialogTitleWarnings).toHaveLength(0);
  });

  test('modal can be closed by pressing escape', async ({ page }) => {
    await page.goto('/settings/integrations');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Open the modal
    const integrationCard = page.locator('a[href*="/settings/integrations/detail/"]').first();
    await expect(integrationCard).toBeVisible({ timeout: 15000 });
    await integrationCard.click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Close with Escape key
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible({ timeout: 3000 });
  });

  test('modal has accessible title element', async ({ page }) => {
    await page.goto('/settings/integrations');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Open the modal
    const integrationCard = page.locator('a[href*="/settings/integrations/detail/"]').first();
    await expect(integrationCard).toBeVisible({ timeout: 15000 });
    await integrationCard.click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Check for title element (may be visually hidden but must exist for accessibility)
    // The DialogTitle should be rendered even if visually hidden
    const title = dialog.locator('h2').first();
    await expect(title).toBeAttached({ timeout: 3000 });
  });
});
