/**
 * Test helper functions for E2E tests.
 *
 * Provides reusable assertions and actions.
 */

import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { URLS } from './auth-fixtures';

// =============================================================================
// Page State Assertions
// =============================================================================

/**
 * Assert the page is at a specific URL.
 */
export async function assertAtUrl(page: Page, url: string): Promise<void> {
  await expect(page).toHaveURL(url);
}

/**
 * Assert the page URL contains a substring.
 */
export function assertUrlContains(page: Page, substring: string): void {
  expect(page.url()).toContain(substring);
}

/**
 * Assert a heading is visible with exact text.
 */
export async function assertHeadingVisible(page: Page, text: string): Promise<void> {
  await expect(page.getByRole('heading', { name: text })).toBeVisible();
}

/**
 * Assert a button is visible with name matching pattern.
 */
export async function assertButtonVisible(page: Page, namePattern: RegExp): Promise<void> {
  await expect(page.getByRole('button', { name: namePattern })).toBeVisible();
}

/**
 * Assert a button is disabled.
 */
export async function assertButtonDisabled(page: Page, namePattern: RegExp): Promise<void> {
  await expect(page.getByRole('button', { name: namePattern })).toBeDisabled();
}

/**
 * Assert a button is enabled.
 */
export async function assertButtonEnabled(page: Page, namePattern: RegExp): Promise<void> {
  await expect(page.getByRole('button', { name: namePattern })).toBeEnabled();
}

/**
 * Assert an element is not visible.
 */
export async function assertNotVisible(page: Page, selector: string): Promise<void> {
  await expect(page.locator(selector)).not.toBeVisible();
}

/**
 * Assert text is visible on page.
 */
export async function assertTextVisible(page: Page, text: string | RegExp): Promise<void> {
  await expect(page.getByText(text)).toBeVisible();
}

/**
 * Assert text is not visible on page.
 */
export async function assertTextNotVisible(page: Page, text: string | RegExp): Promise<void> {
  await expect(page.getByText(text)).not.toBeVisible();
}

/**
 * Assert link is visible with specific href.
 */
export async function assertLinkVisible(
  page: Page,
  name: string | RegExp,
  href: string,
): Promise<void> {
  const link = page.getByRole('link', { name });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', href);
}

// =============================================================================
// Page Actions
// =============================================================================

/**
 * Navigate to a URL and wait for load.
 */
export async function navigateTo(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
}

/**
 * Click a button by name pattern.
 */
export async function clickButton(page: Page, namePattern: RegExp): Promise<void> {
  await page.getByRole('button', { name: namePattern }).click();
}

/**
 * Click a link by name.
 */
export async function clickLink(page: Page, name: string | RegExp): Promise<void> {
  await page.getByRole('link', { name }).click();
}

/**
 * Wait for navigation to a URL.
 */
export async function waitForNavigation(
  page: Page,
  urlPattern: string | RegExp,
  timeout = 10000,
): Promise<void> {
  await page.waitForURL(urlPattern, { timeout });
}

/**
 * Wait for a specific amount of time (use sparingly).
 */
export async function wait(page: Page, ms: number): Promise<void> {
  await page.waitForTimeout(ms);
}

// =============================================================================
// OAuth-Specific Helpers
// =============================================================================

export const OAUTH_BUTTONS = {
  GOOGLE: /continue with google/i,
  APPLE: /continue with apple/i,
  MICROSOFT: /continue with microsoft/i,
} as const;

export const PASSKEY_BUTTON = /sign in with passkey/i;

/**
 * Assert all OAuth buttons are visible.
 */
export async function assertAllOAuthButtonsVisible(page: Page): Promise<void> {
  await assertButtonVisible(page, OAUTH_BUTTONS.GOOGLE);
  await assertButtonVisible(page, OAUTH_BUTTONS.APPLE);
  await assertButtonVisible(page, OAUTH_BUTTONS.MICROSOFT);
}

/**
 * Assert all OAuth buttons are enabled.
 */
export async function assertAllOAuthButtonsEnabled(page: Page): Promise<void> {
  await assertButtonEnabled(page, OAUTH_BUTTONS.GOOGLE);
  await assertButtonEnabled(page, OAUTH_BUTTONS.APPLE);
  await assertButtonEnabled(page, OAUTH_BUTTONS.MICROSOFT);
}

/**
 * Assert all OAuth buttons are disabled.
 */
export async function assertAllOAuthButtonsDisabled(page: Page): Promise<void> {
  await assertButtonDisabled(page, OAUTH_BUTTONS.GOOGLE);
  await assertButtonDisabled(page, OAUTH_BUTTONS.APPLE);
  await assertButtonDisabled(page, OAUTH_BUTTONS.MICROSOFT);
}

/**
 * Click Google OAuth button.
 */
export async function clickGoogleOAuth(page: Page): Promise<void> {
  await clickButton(page, OAUTH_BUTTONS.GOOGLE);
}

/**
 * Click Apple OAuth button.
 */
export async function clickAppleOAuth(page: Page): Promise<void> {
  await clickButton(page, OAUTH_BUTTONS.APPLE);
}

/**
 * Click Microsoft OAuth button.
 */
export async function clickMicrosoftOAuth(page: Page): Promise<void> {
  await clickButton(page, OAUTH_BUTTONS.MICROSOFT);
}

/**
 * Click passkey button.
 */
export async function clickPasskey(page: Page): Promise<void> {
  await clickButton(page, PASSKEY_BUTTON);
}

// =============================================================================
// Landing Page Helpers
// =============================================================================

export const LANDING_PAGE = {
  HEADING: 'Athena',
  SIGN_IN_BUTTON: 'Sign In',
  CREATE_ACCOUNT_BUTTON: 'Create Account',
} as const;

/**
 * Assert landing page is fully loaded and correct.
 */
export async function assertLandingPageLoaded(page: Page): Promise<void> {
  await assertHeadingVisible(page, LANDING_PAGE.HEADING);
  await assertLinkVisible(page, LANDING_PAGE.SIGN_IN_BUTTON, URLS.SIGN_IN);
  await assertLinkVisible(page, LANDING_PAGE.CREATE_ACCOUNT_BUTTON, URLS.SIGN_UP);
}

// =============================================================================
// Sign In Page Helpers
// =============================================================================

export const SIGN_IN_PAGE = {
  HEADING: 'Welcome back',
  SUBHEADING: 'Sign in to continue to Athena',
  SIGN_UP_LINK_TEXT: /sign up/i,
} as const;

/**
 * Assert sign in page is fully loaded and correct.
 */
export async function assertSignInPageLoaded(page: Page): Promise<void> {
  await assertAtUrl(page, URLS.SIGN_IN);
  await assertHeadingVisible(page, SIGN_IN_PAGE.HEADING);
  await assertTextVisible(page, SIGN_IN_PAGE.SUBHEADING);
  await assertAllOAuthButtonsVisible(page);
}

// =============================================================================
// Sign Up Page Helpers
// =============================================================================

export const SIGN_UP_PAGE = {
  HEADING: 'Create your account',
  SUBHEADING: 'Get started with Athena',
  SIGN_IN_LINK_TEXT: /sign in/i,
  PASSKEY_HINT: /you can add a passkey for faster sign-in/i,
} as const;

/**
 * Assert sign up page is fully loaded and correct.
 */
export async function assertSignUpPageLoaded(page: Page): Promise<void> {
  await assertAtUrl(page, URLS.SIGN_UP);
  await assertHeadingVisible(page, SIGN_UP_PAGE.HEADING);
  await assertTextVisible(page, SIGN_UP_PAGE.SUBHEADING);
  await assertAllOAuthButtonsVisible(page);
}

// =============================================================================
// Agenda Page Helpers
// =============================================================================

/**
 * Assert user is on the home page (authenticated).
 */
export function assertOnHomePage(page: Page): void {
  assertUrlContains(page, '/home');
}

/**
 * Assert user is on the agenda page (authenticated).
 * @deprecated Use assertOnHomePage instead
 */
export function assertOnAgendaPage(page: Page): void {
  assertUrlContains(page, '/home');
}
