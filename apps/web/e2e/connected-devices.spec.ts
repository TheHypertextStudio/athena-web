/**
 * Connected Devices E2E Tests
 *
 * Tests for the Connected Devices section in Settings → Security.
 * This section allows users to manage app passwords for CalDAV/CardDAV sync.
 *
 * Test Coverage:
 * - Section structure and display
 * - Empty state
 * - Device list display
 * - Add device flow (multi-step dialog)
 * - Rename device flow
 * - Revoke device flow
 * - Error handling
 */

import { test, expect } from '@playwright/test';
import {
  clearAuthState,
  mockAuthenticatedSession,
  setAuthenticatedState,
} from './fixtures/auth-fixtures';
import {
  mockEmptyAppPasswords,
  mockAppPasswordsList,
  mockAppPasswordUpdate,
  mockAppPasswordsError,
  SETTINGS_URLS,
  CONNECTED_DEVICES_UI,
  TEST_APP_PASSWORD,
  TEST_APP_PASSWORD_2,
} from './fixtures/settings-fixtures';
import { navigateTo, assertTextVisible } from './fixtures/test-helpers';

// =============================================================================
// Setup Helpers
// =============================================================================

async function setupAuthenticatedPage(
  page: Parameters<typeof mockAuthenticatedSession>[0],
  context: Parameters<typeof clearAuthState>[0],
): Promise<void> {
  await clearAuthState(context);
  await setAuthenticatedState(context);
  await mockAuthenticatedSession(page);
}

async function navigateToSecuritySettings(page: Parameters<typeof navigateTo>[0]): Promise<void> {
  await navigateTo(page, SETTINGS_URLS.SECURITY);
}

// =============================================================================
// SECTION 1: Section Structure
// =============================================================================

test.describe('Connected Devices - Section Structure', () => {
  test.beforeEach(async ({ page, context }) => {
    await setupAuthenticatedPage(page, context);
    await mockAppPasswordsList(page);
    await mockAppPasswordUpdate(page);
  });

  test('displays section title', async ({ page }) => {
    await navigateToSecuritySettings(page);
    await assertTextVisible(page, CONNECTED_DEVICES_UI.SECTION_TITLE);
  });

  test('displays section description', async ({ page }) => {
    await navigateToSecuritySettings(page);
    await assertTextVisible(page, CONNECTED_DEVICES_UI.SECTION_DESCRIPTION);
  });

  test('displays add device button', async ({ page }) => {
    await navigateToSecuritySettings(page);
    const addButton = page.getByRole('button', { name: CONNECTED_DEVICES_UI.ADD_BUTTON });
    await expect(addButton).toBeVisible();
  });
});

// =============================================================================
// SECTION 2: Empty State
// =============================================================================

test.describe('Connected Devices - Empty State', () => {
  test.beforeEach(async ({ page, context }) => {
    await setupAuthenticatedPage(page, context);
    await mockEmptyAppPasswords(page);
  });

  test('displays empty state message when no devices', async ({ page }) => {
    await navigateToSecuritySettings(page);
    await assertTextVisible(page, CONNECTED_DEVICES_UI.EMPTY_STATE);
  });

  test('displays add device button in empty state', async ({ page }) => {
    await navigateToSecuritySettings(page);
    const addButton = page.getByRole('button', { name: CONNECTED_DEVICES_UI.ADD_BUTTON });
    await expect(addButton).toBeVisible();
    await expect(addButton).toBeEnabled();
  });
});

// =============================================================================
// SECTION 3: Device List Display
// =============================================================================

test.describe('Connected Devices - Device List', () => {
  test.beforeEach(async ({ page, context }) => {
    await setupAuthenticatedPage(page, context);
    await mockAppPasswordsList(page);
    await mockAppPasswordUpdate(page);
  });

  test('displays device name', async ({ page }) => {
    await navigateToSecuritySettings(page);
    await assertTextVisible(page, TEST_APP_PASSWORD.name);
  });

  test('displays second device name', async ({ page }) => {
    await navigateToSecuritySettings(page);
    await assertTextVisible(page, TEST_APP_PASSWORD_2.name);
  });

  test('displays last used information for device with usage', async ({ page }) => {
    await navigateToSecuritySettings(page);
    // Should show "Last used: X hours ago from 192.168.1.x"
    await assertTextVisible(page, /last used/i);
  });

  test('displays "Never used" for device without usage', async ({ page }) => {
    await navigateToSecuritySettings(page);
    await assertTextVisible(page, /never used/i);
  });

  test('displays scope information (Calendars)', async ({ page }) => {
    await navigateToSecuritySettings(page);
    await assertTextVisible(page, /calendars/i);
  });
});

// =============================================================================
// SECTION 4: Add Device Flow - Step 1 (Name Input)
// =============================================================================

test.describe('Connected Devices - Add Device Dialog (Step 1)', () => {
  test.beforeEach(async ({ page, context }) => {
    await setupAuthenticatedPage(page, context);
    await mockAppPasswordsList(page);
    await mockAppPasswordUpdate(page);
  });

  test('clicking Add device button opens dialog', async ({ page }) => {
    await navigateToSecuritySettings(page);
    await page.getByRole('button', { name: CONNECTED_DEVICES_UI.ADD_BUTTON }).click();
    await assertTextVisible(page, CONNECTED_DEVICES_UI.ADD_DIALOG_TITLE);
  });

  test('dialog displays device name input', async ({ page }) => {
    await navigateToSecuritySettings(page);
    await page.getByRole('button', { name: CONNECTED_DEVICES_UI.ADD_BUTTON }).click();
    const input = page.getByPlaceholder(/e\.g\., iPhone Calendar/i);
    await expect(input).toBeVisible();
  });

  test('dialog displays quick select preset buttons', async ({ page }) => {
    await navigateToSecuritySettings(page);
    await page.getByRole('button', { name: CONNECTED_DEVICES_UI.ADD_BUTTON }).click();

    for (const preset of CONNECTED_DEVICES_UI.DEVICE_PRESETS) {
      const presetButton = page.getByRole('button', { name: preset });
      await expect(presetButton).toBeVisible();
    }
  });

  test('clicking preset button populates device name input', async ({ page }) => {
    await navigateToSecuritySettings(page);
    await page.getByRole('button', { name: CONNECTED_DEVICES_UI.ADD_BUTTON }).click();

    const preset = CONNECTED_DEVICES_UI.DEVICE_PRESETS[0];
    await page.getByRole('button', { name: preset, exact: true }).click();

    const input = page.getByPlaceholder(/e\.g\., iPhone Calendar/i);
    await expect(input).toHaveValue(preset);
  });

  test('Create password button is disabled when name is empty', async ({ page }) => {
    await navigateToSecuritySettings(page);
    await page.getByRole('button', { name: CONNECTED_DEVICES_UI.ADD_BUTTON }).click();

    const createButton = page.getByRole('button', { name: CONNECTED_DEVICES_UI.CREATE_BUTTON });
    await expect(createButton).toBeDisabled();
  });

  test('Create password button is enabled when name is entered', async ({ page }) => {
    await navigateToSecuritySettings(page);
    await page.getByRole('button', { name: CONNECTED_DEVICES_UI.ADD_BUTTON }).click();

    const input = page.getByPlaceholder(/e\.g\., iPhone Calendar/i);
    await input.fill('Test Device');

    const createButton = page.getByRole('button', { name: CONNECTED_DEVICES_UI.CREATE_BUTTON });
    await expect(createButton).toBeEnabled();
  });

  test('Cancel button closes dialog', async ({ page }) => {
    await navigateToSecuritySettings(page);
    await page.getByRole('button', { name: CONNECTED_DEVICES_UI.ADD_BUTTON }).click();
    await page.getByRole('button', { name: CONNECTED_DEVICES_UI.CANCEL_BUTTON }).click();

    // Dialog should be closed
    await expect(page.getByText(CONNECTED_DEVICES_UI.ADD_DIALOG_TITLE)).not.toBeVisible();
  });
});

// =============================================================================
// SECTION 5: Add Device Flow - Step 2 (Password Display)
// =============================================================================

test.describe('Connected Devices - Add Device Dialog (Step 2)', () => {
  test.beforeEach(async ({ page, context }) => {
    await setupAuthenticatedPage(page, context);
    await mockAppPasswordsList(page);
    await mockAppPasswordUpdate(page);
  });

  test('submitting name shows password step', async ({ page }) => {
    await navigateToSecuritySettings(page);
    await page.getByRole('button', { name: CONNECTED_DEVICES_UI.ADD_BUTTON }).click();

    const input = page.getByPlaceholder(/e\.g\., iPhone Calendar/i);
    await input.fill('Test Device');
    await page.getByRole('button', { name: CONNECTED_DEVICES_UI.CREATE_BUTTON }).click();

    // Wait for password step to appear
    await expect(page.getByText(/set up test device/i)).toBeVisible({ timeout: 5000 });
  });

  test('password step displays server URL', async ({ page }) => {
    await navigateToSecuritySettings(page);
    await page.getByRole('button', { name: CONNECTED_DEVICES_UI.ADD_BUTTON }).click();

    const input = page.getByPlaceholder(/e\.g\., iPhone Calendar/i);
    await input.fill('Test Device');
    await page.getByRole('button', { name: CONNECTED_DEVICES_UI.CREATE_BUTTON }).click();

    await expect(page.getByText(/set up test device/i)).toBeVisible({ timeout: 5000 });
    await assertTextVisible(page, /server/i);
  });

  test('password step displays generated password', async ({ page }) => {
    await navigateToSecuritySettings(page);
    await page.getByRole('button', { name: CONNECTED_DEVICES_UI.ADD_BUTTON }).click();

    const input = page.getByPlaceholder(/e\.g\., iPhone Calendar/i);
    await input.fill('Test Device');
    await page.getByRole('button', { name: CONNECTED_DEVICES_UI.CREATE_BUTTON }).click();

    await expect(page.getByText(/set up test device/i)).toBeVisible({ timeout: 5000 });
    // Password should be visible in code format (xxxx-xxxx-xxxx-xxxx pattern)
    await assertTextVisible(page, /test-1234-5678-abcd/i);
  });

  test('password step displays setup instructions', async ({ page }) => {
    await navigateToSecuritySettings(page);
    await page.getByRole('button', { name: CONNECTED_DEVICES_UI.ADD_BUTTON }).click();

    const input = page.getByPlaceholder(/e\.g\., iPhone Calendar/i);
    await input.fill('Test Device');
    await page.getByRole('button', { name: CONNECTED_DEVICES_UI.CREATE_BUTTON }).click();

    await expect(page.getByText(/set up test device/i)).toBeVisible({ timeout: 5000 });
    await assertTextVisible(page, /setup instructions/i);
  });

  test('password step displays warning about saving password', async ({ page }) => {
    await navigateToSecuritySettings(page);
    await page.getByRole('button', { name: CONNECTED_DEVICES_UI.ADD_BUTTON }).click();

    const input = page.getByPlaceholder(/e\.g\., iPhone Calendar/i);
    await input.fill('Test Device');
    await page.getByRole('button', { name: CONNECTED_DEVICES_UI.CREATE_BUTTON }).click();

    await expect(page.getByText(/set up test device/i)).toBeVisible({ timeout: 5000 });
    await assertTextVisible(page, /save this password/i);
  });

  test('Done button closes dialog', async ({ page }) => {
    await navigateToSecuritySettings(page);
    await page.getByRole('button', { name: CONNECTED_DEVICES_UI.ADD_BUTTON }).click();

    const input = page.getByPlaceholder(/e\.g\., iPhone Calendar/i);
    await input.fill('Test Device');
    await page.getByRole('button', { name: CONNECTED_DEVICES_UI.CREATE_BUTTON }).click();

    await expect(page.getByText(/set up test device/i)).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: CONNECTED_DEVICES_UI.DONE_BUTTON }).click();

    // Dialog should be closed
    await expect(page.getByText(/set up test device/i)).not.toBeVisible();
  });
});

// =============================================================================
// SECTION 6: Rename Device Flow
// =============================================================================

test.describe('Connected Devices - Rename Device', () => {
  test.beforeEach(async ({ page, context }) => {
    await setupAuthenticatedPage(page, context);
    await mockAppPasswordsList(page);
    await mockAppPasswordUpdate(page);
  });

  test('device card has rename button', async ({ page }) => {
    await navigateToSecuritySettings(page);
    // Find the edit button (icon button)
    const editButtons = page.locator(
      '[aria-label="Edit"], button:has([data-testid="EditOutlinedIcon"])',
    );
    await expect(editButtons.first()).toBeVisible();
  });

  test('clicking rename button opens rename dialog', async ({ page }) => {
    await navigateToSecuritySettings(page);

    // Wait for devices to load
    await expect(page.getByText(TEST_APP_PASSWORD.name)).toBeVisible();

    // Find the first card and click its edit button
    const firstDeviceCard = page.getByText(TEST_APP_PASSWORD.name).locator('..').locator('..');
    const editButton = firstDeviceCard.locator('button').first();
    await editButton.click();

    await assertTextVisible(page, CONNECTED_DEVICES_UI.RENAME_DIALOG_TITLE);
  });

  test('rename dialog pre-fills current device name', async ({ page }) => {
    await navigateToSecuritySettings(page);
    await expect(page.getByText(TEST_APP_PASSWORD.name)).toBeVisible();

    const firstDeviceCard = page.getByText(TEST_APP_PASSWORD.name).locator('..').locator('..');
    const editButton = firstDeviceCard.locator('button').first();
    await editButton.click();

    const input = page.locator('input[placeholder*="e.g.,"]');
    await expect(input).toHaveValue(TEST_APP_PASSWORD.name);
  });

  test('Save button is disabled when name is empty', async ({ page }) => {
    await navigateToSecuritySettings(page);
    await expect(page.getByText(TEST_APP_PASSWORD.name)).toBeVisible();

    const firstDeviceCard = page.getByText(TEST_APP_PASSWORD.name).locator('..').locator('..');
    const editButton = firstDeviceCard.locator('button').first();
    await editButton.click();

    const input = page.locator('input[placeholder*="e.g.,"]');
    await input.clear();

    const saveButton = page.getByRole('button', { name: CONNECTED_DEVICES_UI.SAVE_BUTTON });
    await expect(saveButton).toBeDisabled();
  });

  test('saving rename closes dialog', async ({ page }) => {
    await navigateToSecuritySettings(page);
    await expect(page.getByText(TEST_APP_PASSWORD.name)).toBeVisible();

    const firstDeviceCard = page.getByText(TEST_APP_PASSWORD.name).locator('..').locator('..');
    const editButton = firstDeviceCard.locator('button').first();
    await editButton.click();

    const input = page.locator('input[placeholder*="e.g.,"]');
    await input.clear();
    await input.fill('Renamed Device');

    await page.getByRole('button', { name: CONNECTED_DEVICES_UI.SAVE_BUTTON }).click();

    // Dialog should close
    await expect(page.getByText(CONNECTED_DEVICES_UI.RENAME_DIALOG_TITLE)).not.toBeVisible({
      timeout: 5000,
    });
  });
});

// =============================================================================
// SECTION 7: Revoke Device Flow
// =============================================================================

test.describe('Connected Devices - Revoke Device', () => {
  test.beforeEach(async ({ page, context }) => {
    await setupAuthenticatedPage(page, context);
    await mockAppPasswordsList(page);
    await mockAppPasswordUpdate(page);
  });

  test('device card has revoke button', async ({ page }) => {
    await navigateToSecuritySettings(page);
    // Find delete button (second icon button in actions)
    const deleteButtons = page.locator('button:has([data-testid="DeleteOutlinedIcon"])');
    await expect(deleteButtons.first()).toBeVisible();
  });

  test('clicking revoke button opens confirmation dialog', async ({ page }) => {
    await navigateToSecuritySettings(page);
    await expect(page.getByText(TEST_APP_PASSWORD.name)).toBeVisible();

    // Find the delete button for the first device
    const firstDeviceCard = page.getByText(TEST_APP_PASSWORD.name).locator('..').locator('..');
    const deleteButton = firstDeviceCard.locator('button').nth(1); // Second button is delete
    await deleteButton.click();

    await assertTextVisible(page, CONNECTED_DEVICES_UI.REVOKE_DIALOG_TITLE);
  });

  test('revoke confirmation dialog shows device name', async ({ page }) => {
    await navigateToSecuritySettings(page);
    await expect(page.getByText(TEST_APP_PASSWORD.name)).toBeVisible();

    const firstDeviceCard = page.getByText(TEST_APP_PASSWORD.name).locator('..').locator('..');
    const deleteButton = firstDeviceCard.locator('button').nth(1);
    await deleteButton.click();

    // Should mention the device name in the warning
    await assertTextVisible(page, new RegExp(TEST_APP_PASSWORD.name));
  });

  test('revoke confirmation dialog has cancel button', async ({ page }) => {
    await navigateToSecuritySettings(page);
    await expect(page.getByText(TEST_APP_PASSWORD.name)).toBeVisible();

    const firstDeviceCard = page.getByText(TEST_APP_PASSWORD.name).locator('..').locator('..');
    const deleteButton = firstDeviceCard.locator('button').nth(1);
    await deleteButton.click();

    const cancelButton = page.getByRole('button', { name: /cancel/i });
    await expect(cancelButton).toBeVisible();
  });

  test('cancel button closes revoke dialog', async ({ page }) => {
    await navigateToSecuritySettings(page);
    await expect(page.getByText(TEST_APP_PASSWORD.name)).toBeVisible();

    const firstDeviceCard = page.getByText(TEST_APP_PASSWORD.name).locator('..').locator('..');
    const deleteButton = firstDeviceCard.locator('button').nth(1);
    await deleteButton.click();

    await page.getByRole('button', { name: /cancel/i }).click();

    // Dialog should be closed
    await expect(page.getByText(CONNECTED_DEVICES_UI.REVOKE_DIALOG_TITLE)).not.toBeVisible();
  });

  test('confirming revoke closes dialog', async ({ page }) => {
    await navigateToSecuritySettings(page);
    await expect(page.getByText(TEST_APP_PASSWORD.name)).toBeVisible();

    const firstDeviceCard = page.getByText(TEST_APP_PASSWORD.name).locator('..').locator('..');
    const deleteButton = firstDeviceCard.locator('button').nth(1);
    await deleteButton.click();

    await page.getByRole('button', { name: CONNECTED_DEVICES_UI.REVOKE_CONFIRM }).click();

    // Dialog should close after API call completes
    await expect(page.getByText(CONNECTED_DEVICES_UI.REVOKE_DIALOG_TITLE)).not.toBeVisible({
      timeout: 5000,
    });
  });
});

// =============================================================================
// SECTION 8: Loading States
// =============================================================================

test.describe('Connected Devices - Loading States', () => {
  test('shows loading skeleton while fetching devices', async ({ page, context }) => {
    await setupAuthenticatedPage(page, context);

    // Delay the API response to observe loading state
    await page.route('**/api/app-passwords', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      });
    });

    await page.goto(SETTINGS_URLS.SECURITY);

    // Should see loading skeleton (animated pulse elements)
    const skeletons = page.locator('.animate-pulse');
    await expect(skeletons.first()).toBeVisible();
  });
});

// =============================================================================
// SECTION 9: Error Handling
// =============================================================================

test.describe('Connected Devices - Error Handling', () => {
  test('displays error when API returns 401', async ({ page, context }) => {
    await setupAuthenticatedPage(page, context);
    await mockAppPasswordsError(page, 401, 'unauthorized');

    await navigateToSecuritySettings(page);

    // Should show error state
    await assertTextVisible(page, /sign in/i);
  });

  test('displays error when API returns 403', async ({ page, context }) => {
    await setupAuthenticatedPage(page, context);
    await mockAppPasswordsError(page, 403, 'forbidden');

    await navigateToSecuritySettings(page);

    // Should show error state
    await assertTextVisible(page, /permission/i);
  });

  test('displays error when API returns 429', async ({ page, context }) => {
    await setupAuthenticatedPage(page, context);
    await mockAppPasswordsError(page, 429, 'rate_limited');

    await navigateToSecuritySettings(page);

    // Should show rate limit error
    await assertTextVisible(page, /too many requests/i);
  });

  test('displays generic error for server errors', async ({ page, context }) => {
    await setupAuthenticatedPage(page, context);
    await mockAppPasswordsError(page, 500, 'internal_error');

    await navigateToSecuritySettings(page);

    // Should show generic error
    await assertTextVisible(page, /unexpected error|something went wrong/i);
  });

  test('page remains functional after error', async ({ page, context }) => {
    await setupAuthenticatedPage(page, context);
    await mockAppPasswordsError(page, 500, 'internal_error');

    await navigateToSecuritySettings(page);

    // Page should still be responsive
    const body = page.locator('body');
    await expect(body).toBeVisible();

    // Other sections on the page should still work
    await assertTextVisible(page, /sign-in methods|passkeys|sessions/i);
  });
});

// =============================================================================
// SECTION 10: Clipboard Operations
// =============================================================================

test.describe('Connected Devices - Clipboard', () => {
  test.beforeEach(async ({ page, context }) => {
    await setupAuthenticatedPage(page, context);
    await mockAppPasswordsList(page);
    await mockAppPasswordUpdate(page);

    // Grant clipboard permissions
    await context.grantPermissions(['clipboard-write', 'clipboard-read']);
  });

  test('password step has copy buttons', async ({ page }) => {
    await navigateToSecuritySettings(page);
    await page.getByRole('button', { name: CONNECTED_DEVICES_UI.ADD_BUTTON }).click();

    const input = page.getByPlaceholder(/e\.g\., iPhone Calendar/i);
    await input.fill('Test Device');
    await page.getByRole('button', { name: CONNECTED_DEVICES_UI.CREATE_BUTTON }).click();

    await expect(page.getByText(/set up test device/i)).toBeVisible({ timeout: 5000 });

    // Should have copy buttons (for server and password)
    const copyButtons = page.locator('button:has([data-testid="ContentCopyOutlinedIcon"])');
    await expect(copyButtons.first()).toBeVisible();
    expect(await copyButtons.count()).toBeGreaterThanOrEqual(2);
  });
});
