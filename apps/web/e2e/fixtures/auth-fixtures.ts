/**
 * Auth test fixtures and mocks.
 *
 * Provides consistent test data and mock responses for auth testing.
 */

import type { Page, BrowserContext, Route } from '@playwright/test';

// =============================================================================
// Test Data
// =============================================================================

export const TEST_USER = {
  id: 'test-user-123',
  email: 'testuser@example.com',
  name: 'Test User',
  emailVerified: true,
  image: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
} as const;

export const TEST_SESSION = {
  id: 'test-session-456',
  userId: TEST_USER.id,
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  token: 'mock-session-token-xyz',
} as const;

// =============================================================================
// Mock Response Builders
// =============================================================================

export function buildAuthenticatedSessionResponse() {
  return {
    user: TEST_USER,
    session: TEST_SESSION,
  };
}

export function buildUnauthenticatedSessionResponse() {
  return {
    user: null,
    session: null,
  };
}

export function buildOAuthRedirectUrl(provider: 'google' | 'apple' | 'microsoft'): string {
  const urls = {
    google: 'https://accounts.google.com/o/oauth2/v2/auth',
    apple: 'https://appleid.apple.com/auth/authorize',
    microsoft: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
  };
  return urls[provider];
}

// =============================================================================
// Route Handlers
// =============================================================================

/**
 * Mock authenticated session for all auth requests.
 */
export async function mockAuthenticatedSession(page: Page): Promise<void> {
  await page.route('**/api/auth/get-session', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildAuthenticatedSessionResponse()),
    });
  });
}

/**
 * Mock unauthenticated session for all auth requests.
 */
export async function mockUnauthenticatedSession(page: Page): Promise<void> {
  await page.route('**/api/auth/get-session', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildUnauthenticatedSessionResponse()),
    });
  });
}

/**
 * Mock successful OAuth callback that creates a session.
 */
export async function mockSuccessfulOAuthCallback(
  page: Page,
  context: BrowserContext,
  provider: 'google' | 'apple' | 'microsoft',
): Promise<void> {
  await page.route(`**/api/auth/callback/${provider}**`, async (route: Route) => {
    // Set session cookie
    await context.addCookies([
      {
        name: 'better-auth.session_token',
        value: TEST_SESSION.token,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      },
    ]);

    // Redirect to home
    await route.fulfill({
      status: 302,
      headers: {
        Location: 'http://localhost:3000/home',
      },
    });
  });
}

/**
 * Mock OAuth initiation to redirect to provider.
 */
export async function mockOAuthRedirect(
  page: Page,
  provider: 'google' | 'apple' | 'microsoft',
): Promise<void> {
  await page.route(`**/api/auth/signin/${provider}**`, async (route: Route) => {
    const redirectUrl = buildOAuthRedirectUrl(provider);
    await route.fulfill({
      status: 302,
      headers: {
        Location: `${redirectUrl}?client_id=test&redirect_uri=http://localhost:3000/api/auth/callback/${provider}`,
      },
    });
  });
}

/**
 * Mock failed OAuth (provider error).
 */
export async function mockFailedOAuth(
  page: Page,
  provider: 'google' | 'apple' | 'microsoft',
  errorMessage = 'Provider authentication failed',
): Promise<void> {
  await page.route(`**/api/auth/signin/${provider}**`, async (route: Route) => {
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: errorMessage }),
    });
  });
}

// =============================================================================
// Context Helpers
// =============================================================================

/**
 * Clear all auth-related cookies and storage.
 */
export async function clearAuthState(context: BrowserContext): Promise<void> {
  await context.clearCookies();
}

/**
 * Set up authenticated state with cookies.
 */
export async function setAuthenticatedState(context: BrowserContext): Promise<void> {
  await context.addCookies([
    {
      name: 'better-auth.session_token',
      value: TEST_SESSION.token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ]);
}

// =============================================================================
// WebAuthn Helpers
// =============================================================================

export interface VirtualAuthenticator {
  authenticatorId: string;
  cdpSession: Awaited<ReturnType<BrowserContext['newCDPSession']>>;
}

/**
 * Set up a virtual WebAuthn authenticator for passkey testing.
 */
export async function setupVirtualAuthenticator(
  context: BrowserContext,
  page: Page,
): Promise<VirtualAuthenticator> {
  const cdpSession = await context.newCDPSession(page);
  await cdpSession.send('WebAuthn.enable');

  const { authenticatorId } = await cdpSession.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
    },
  });

  return { authenticatorId, cdpSession };
}

/**
 * Clean up virtual authenticator.
 */
export async function cleanupVirtualAuthenticator(auth: VirtualAuthenticator): Promise<void> {
  await auth.cdpSession.send('WebAuthn.removeVirtualAuthenticator', {
    authenticatorId: auth.authenticatorId,
  });
}

// =============================================================================
// URL Constants
// =============================================================================

export const URLS = {
  LANDING: '/',
  SIGN_IN: '/signin',
  SIGN_UP: '/signup',
  HOME: '/home',
  HOME_WEEKLY: '/home/weekly',
  // Keep legacy aliases for backwards compatibility
  AGENDA: '/home',
  AGENDA_WEEKLY: '/home/weekly',
} as const;

export const API_URLS = {
  SESSION: 'http://localhost:3000/api/auth/get-session',
  SIGN_OUT: 'http://localhost:3000/api/auth/sign-out',
  CSRF: 'http://localhost:3000/api/auth/csrf',
  GOOGLE_SIGNIN: 'http://localhost:3000/api/auth/signin/google',
  APPLE_SIGNIN: 'http://localhost:3000/api/auth/signin/apple',
  MICROSOFT_SIGNIN: 'http://localhost:3000/api/auth/signin/microsoft',
  GOOGLE_CALLBACK: 'http://localhost:3000/api/auth/callback/google',
  APPLE_CALLBACK: 'http://localhost:3000/api/auth/callback/apple',
  MICROSOFT_CALLBACK: 'http://localhost:3000/api/auth/callback/microsoft',
} as const;
