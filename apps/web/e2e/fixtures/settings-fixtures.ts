/**
 * Settings test fixtures and mocks.
 *
 * Provides consistent test data and mock responses for settings page testing.
 */

import type { Page, Route } from '@playwright/test';

// =============================================================================
// Test Data
// =============================================================================

export const TEST_APP_PASSWORD = {
  id: 'app-pass-123',
  name: 'iPhone Calendar',
  scopes: ['caldav', 'carddav'],
  lastUsedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
  lastUsedIp: '192.168.1.100',
  expiresAt: null,
  createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), // 1 week ago
} as const;

export const TEST_APP_PASSWORD_2 = {
  id: 'app-pass-456',
  name: 'MacBook Calendar',
  scopes: ['caldav'],
  lastUsedAt: null,
  lastUsedIp: null,
  expiresAt: null,
  createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days ago
} as const;

export const TEST_APP_PASSWORD_WITH_SECRET = {
  ...TEST_APP_PASSWORD,
  password: 'abcd-efgh-ijkl-mnop',
} as const;

// =============================================================================
// Mock Response Builders
// =============================================================================

export function buildEmptyAppPasswordsResponse() {
  return { data: [] };
}

export function buildAppPasswordsResponse() {
  return { data: [TEST_APP_PASSWORD, TEST_APP_PASSWORD_2] };
}

export function buildSingleAppPasswordResponse() {
  return { data: [TEST_APP_PASSWORD] };
}

export function buildCreatedAppPasswordResponse(name: string) {
  return {
    data: {
      id: `app-pass-${String(Date.now())}`,
      name,
      scopes: ['caldav', 'carddav'],
      lastUsedAt: null,
      lastUsedIp: null,
      expiresAt: null,
      createdAt: new Date().toISOString(),
      password: 'test-1234-5678-abcd',
    },
  };
}

// =============================================================================
// Route Handlers
// =============================================================================

/**
 * Mock app passwords list endpoint with empty response.
 */
export async function mockEmptyAppPasswords(page: Page): Promise<void> {
  await page.route('**/api/app-passwords', async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildEmptyAppPasswordsResponse()),
      });
    } else {
      await route.continue();
    }
  });
}

/**
 * Mock app passwords list endpoint with test devices.
 */
export async function mockAppPasswordsList(page: Page): Promise<void> {
  await page.route('**/api/app-passwords', async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildAppPasswordsResponse()),
      });
    } else if (route.request().method() === 'POST') {
      const body = JSON.parse(route.request().postData() ?? '{}') as { name?: string };
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(buildCreatedAppPasswordResponse(body.name ?? 'New Device')),
      });
    } else {
      await route.continue();
    }
  });
}

/**
 * Mock app password update endpoint.
 */
export async function mockAppPasswordUpdate(page: Page): Promise<void> {
  await page.route('**/api/app-passwords/*', async (route: Route) => {
    if (route.request().method() === 'PATCH') {
      const body = JSON.parse(route.request().postData() ?? '{}') as { name?: string };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            ...TEST_APP_PASSWORD,
            name: body.name ?? TEST_APP_PASSWORD.name,
          },
        }),
      });
    } else if (route.request().method() === 'DELETE') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { deleted: true } }),
      });
    } else {
      await route.continue();
    }
  });
}

/**
 * Mock app passwords API with error response.
 */
export async function mockAppPasswordsError(
  page: Page,
  status: number,
  errorCode: string,
): Promise<void> {
  await page.route('**/api/app-passwords', async (route: Route) => {
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: errorCode } }),
    });
  });
}

// =============================================================================
// URL Constants
// =============================================================================

export const SETTINGS_URLS = {
  SECURITY: '/settings/security',
  INTEGRATIONS: '/settings/integrations',
} as const;

export const API_SETTINGS_URLS = {
  APP_PASSWORDS: 'http://localhost:3000/api/app-passwords',
} as const;

// =============================================================================
// UI Constants
// =============================================================================

export const CONNECTED_DEVICES_UI = {
  SECTION_TITLE: 'Connected Devices',
  SECTION_DESCRIPTION: /devices using app passwords/i,
  EMPTY_STATE: /no devices connected/i,
  ADD_BUTTON: /add device/i,
  RENAME_BUTTON_LABEL: 'Edit',
  REVOKE_BUTTON_LABEL: 'Delete',
  REVOKE_DIALOG_TITLE: /revoke.*access/i,
  REVOKE_CONFIRM: /revoke access/i,
  RENAME_DIALOG_TITLE: /rename device/i,
  ADD_DIALOG_TITLE: /add a device/i,
  PASSWORD_SHOWN_TITLE: /set up/i,
  DEVICE_PRESETS: ['iPhone Calendar', 'iPad Calendar', 'MacBook Calendar', 'Thunderbird'],
  CREATE_BUTTON: /create password/i,
  SAVE_BUTTON: /save/i,
  DONE_BUTTON: /done/i,
  CANCEL_BUTTON: /cancel/i,
} as const;
