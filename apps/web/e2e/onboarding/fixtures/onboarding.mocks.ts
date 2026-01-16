/**
 * Onboarding E2E test fixtures and mocks.
 */

import type { BrowserContext, Page, Route } from '@playwright/test';

export type OnboardingStep = 'intent' | 'integrations' | 'agenda';

export const URLS = {
  ONBOARDING: '/onboarding',
  DASHBOARD: '/dashboard',
  HOME: '/home',
  SIGN_IN: '/signin',
} as const;

export const TEST_USER = {
  id: 'test-user-onboarding-123',
  email: 'onboarding-test@example.com',
  name: 'Onboarding Test User',
  emailVerified: true,
  image: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
} as const;

export const TEST_SESSION = {
  id: 'test-session-onboarding-456',
  userId: TEST_USER.id,
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  token: 'mock-onboarding-session-token-xyz',
} as const;

export const INTENT_CHIPS = [
  { id: 'focus', label: 'Focus on what matters', icon: 'F' },
  { id: 'organized', label: 'Get more organized', icon: 'O' },
  { id: 'time', label: 'Better time management', icon: 'T' },
  { id: 'projects', label: 'Track projects', icon: 'P' },
  { id: 'calendars', label: 'Consolidate calendars', icon: 'C' },
  { id: 'ai', label: 'AI-powered productivity', icon: 'A' },
] as const;

export const MOCK_AGENDA_BLOCKS = [
  {
    type: 'time_block',
    source: 'ai',
    title: 'Deep Work',
    description: 'Focused time for important tasks',
    startTime: new Date().toISOString().replace(/T.*/, 'T10:00:00.000Z'),
    endTime: new Date().toISOString().replace(/T.*/, 'T12:00:00.000Z'),
    color: '#8b5cf6',
  },
  {
    type: 'time_block',
    source: 'ai',
    title: 'Lunch Break',
    startTime: new Date().toISOString().replace(/T.*/, 'T12:00:00.000Z'),
    endTime: new Date().toISOString().replace(/T.*/, 'T13:00:00.000Z'),
    color: '#22c55e',
  },
  {
    type: 'time_block',
    source: 'ai',
    title: 'Project Work',
    description: 'Make progress on active projects',
    startTime: new Date().toISOString().replace(/T.*/, 'T14:00:00.000Z'),
    endTime: new Date().toISOString().replace(/T.*/, 'T16:00:00.000Z'),
    color: '#06b6d4',
  },
] as const;

export type AgendaBlock = (typeof MOCK_AGENDA_BLOCKS)[number];

export function buildOnboardingStatusResponse(
  options: {
    step?: OnboardingStep;
    intent?: { selectedChips: string[]; customText?: string | null };
    integrations?: { provider: string; connectedAt: string; syncedEventsCount: number }[];
    agendaGenerated?: boolean;
    isComplete?: boolean;
    isSkipped?: boolean;
  } = {},
) {
  const {
    step = 'intent',
    intent,
    integrations,
    agendaGenerated = false,
    isComplete = false,
    isSkipped = false,
  } = options;

  return {
    currentStep: step,
    metadata: {
      intent: intent ?? null,
      integrations: integrations ?? [],
      agendaGenerated,
    },
    user: {
      name: TEST_USER.name,
      email: TEST_USER.email,
    },
    completedAt: isComplete ? new Date().toISOString() : null,
    skippedAt: isSkipped ? new Date().toISOString() : null,
  };
}

export function buildCalendarConnectionsResponse(
  connections: {
    provider: 'google' | 'outlook' | 'icloud' | 'caldav';
    email?: string;
    calendars?: {
      id: string;
      name: string;
      syncEnabled: boolean;
      syncDirection: 'pull' | 'push' | 'bidirectional';
    }[];
  }[] = [],
) {
  return {
    success: true,
    data: connections.map((c, index) => ({
      id: `connection-${String(index)}`,
      provider: c.provider,
      accountLabel: null,
      accountEmail: c.email ?? `${c.provider}@example.com`,
      accountColor: null,
      isPrimary: index === 0,
      displayOrder: index,
      syncEnabled: true,
      lastSyncAt: new Date().toISOString(),
      lastSyncStatus: 'success',
      lastSyncError: null,
      calendars: c.calendars ?? [
        {
          id: 'cal-1',
          externalId: 'ext-1',
          name: 'Primary',
          color: null,
          isPrimary: true,
          canEdit: true,
          syncEnabled: true,
          syncDirection: 'bidirectional',
        },
      ],
      createdAt: new Date().toISOString(),
    })),
  };
}

export interface OnboardingRequestTracker {
  stepUpdates: { step: string; metadata?: Record<string, unknown> }[];
  skips: number;
  completes: number;
  agendaRequests: { date: string; intent?: unknown }[];
  authRequests: { provider: string }[];
}

export interface OnboardingMockConfig {
  step?: OnboardingStep;
  isComplete?: boolean;
  isSkipped?: boolean;
  connections?: Parameters<typeof buildCalendarConnectionsResponse>[0];
  agenda?: {
    blocks?: AgendaBlock[];
    delayMs?: number;
    error?: string;
  };
  authUrl?: {
    delayMs?: number;
    error?: string;
  };
  stepUpdateError?: string;
  skipError?: string;
  completeError?: string;
  statusError?: string;
}

export function createOnboardingRequestTracker(): OnboardingRequestTracker {
  return {
    stepUpdates: [],
    skips: 0,
    completes: 0,
    agendaRequests: [],
    authRequests: [],
  };
}

export async function setupOnboardingMocks(
  page: Page,
  config: OnboardingMockConfig = {},
): Promise<OnboardingRequestTracker> {
  const tracker = createOnboardingRequestTracker();

  await mockAuthenticatedSession(page);

  if (config.statusError) {
    await mockOnboardingStatusError(page, config.statusError);
  } else {
    await mockOnboardingStatus(page, {
      step: config.step,
      isComplete: config.isComplete,
      isSkipped: config.isSkipped,
    });
  }

  await mockIntentChips(page);
  await mockStepUpdate(page, tracker, config.stepUpdateError);
  await mockOnboardingComplete(page, tracker, config.completeError);
  await mockOnboardingSkip(page, tracker, config.skipError);
  await mockOnboardingGreeting(page);
  await mockOnboardingChat(page);
  await mockAgendaGeneration(page, tracker, config.agenda);
  await mockCalendarConnections(page, config.connections);
  await mockCalendarAuthUrl(page, tracker, config.authUrl);

  return tracker;
}

export async function mockAuthenticatedSession(page: Page): Promise<void> {
  await page.route('**/api/auth/get-session', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: TEST_USER,
        session: TEST_SESSION,
      }),
    });
  });
}

export async function mockOnboardingStatus(
  page: Page,
  options: Parameters<typeof buildOnboardingStatusResponse>[0] = {},
): Promise<void> {
  await page.route('**/api/onboarding', async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildOnboardingStatusResponse(options)),
      });
      return;
    }

    await route.continue();
  });
}

export async function mockOnboardingStatusError(page: Page, message: string): Promise<void> {
  await page.route('**/api/onboarding', async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: message }),
      });
      return;
    }

    await route.continue();
  });
}

export async function mockIntentChips(page: Page): Promise<void> {
  await page.route('**/api/onboarding/intent-chips', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ chips: INTENT_CHIPS }),
    });
  });
}

export async function mockStepUpdate(
  page: Page,
  tracker: OnboardingRequestTracker,
  errorMessage?: string,
): Promise<void> {
  await page.route('**/api/onboarding/step', async (route: Route) => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON() as {
        step: string;
        metadata?: Record<string, unknown>;
      };
      tracker.stepUpdates.push({ step: body.step, metadata: body.metadata });

      if (errorMessage) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: errorMessage }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          currentStep: body.step,
          metadata: body.metadata ?? {},
        }),
      });
      return;
    }

    await route.continue();
  });
}

export async function mockOnboardingComplete(
  page: Page,
  tracker: OnboardingRequestTracker,
  errorMessage?: string,
): Promise<void> {
  await page.route('**/api/onboarding/complete', async (route: Route) => {
    tracker.completes += 1;

    if (errorMessage) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: errorMessage }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        completedAt: new Date().toISOString(),
        redirectTo: '/home',
      }),
    });
  });
}

export async function mockOnboardingSkip(
  page: Page,
  tracker: OnboardingRequestTracker,
  errorMessage?: string,
): Promise<void> {
  await page.route('**/api/onboarding/skip', async (route: Route) => {
    tracker.skips += 1;

    if (errorMessage) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: errorMessage }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        skippedAt: new Date().toISOString(),
        redirectTo: '/home',
      }),
    });
  });
}

export async function mockOnboardingGreeting(page: Page): Promise<void> {
  await page.route('**/api/onboarding/greeting', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body:
        `event: content\ndata: {"content": "Hey there! What brings you to Athena?"}\n\n\n` +
        `event: done\ndata: {}\n\n`,
    });
  });
}

export async function mockOnboardingChat(page: Page): Promise<void> {
  await page.route('**/api/onboarding/chat', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body:
        `event: content\ndata: {"content": "Got it. Let's keep going."}\n\n\n` +
        `event: done\ndata: {}\n\n`,
    });
  });
}

export async function mockAgendaGeneration(
  page: Page,
  tracker: OnboardingRequestTracker,
  agenda?: OnboardingMockConfig['agenda'],
): Promise<void> {
  await page.route('**/api/onboarding/generate-agenda', async (route: Route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }

    const body = route.request().postDataJSON() as { date: string; intent?: unknown };
    tracker.agendaRequests.push({ date: body.date, intent: body.intent });

    if (agenda?.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, agenda.delayMs));
    }

    if (agenda?.error) {
      await route.fulfill({
        status: 500,
        contentType: 'text/event-stream',
        body: `event: error\ndata: {"error": "${agenda.error}"}\n\n`,
      });
      return;
    }

    const blocks = agenda?.blocks ?? [...MOCK_AGENDA_BLOCKS];
    let sseBody = '';
    for (const block of blocks) {
      sseBody += `event: block\n`;
      sseBody += `data: ${JSON.stringify(block)}\n\n`;
    }
    sseBody += `event: done\n`;
    sseBody += `data: {"totalBlocks": ${String(blocks.length)}}\n\n`;

    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: sseBody,
    });
  });
}

export async function mockCalendarConnections(
  page: Page,
  connections: Parameters<typeof buildCalendarConnectionsResponse>[0] = [],
): Promise<void> {
  await page.route('**/api/calendar-sync/connections**', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildCalendarConnectionsResponse(connections)),
    });
  });
}

export async function mockCalendarAuthUrl(
  page: Page,
  tracker: OnboardingRequestTracker,
  config?: OnboardingMockConfig['authUrl'],
): Promise<void> {
  await page.route('**/api/calendar-sync/auth/**', async (route: Route) => {
    const url = new URL(route.request().url());
    const provider = url.pathname.split('/').pop() ?? 'google';
    tracker.authRequests.push({ provider });

    if (config?.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, config.delayMs));
    }

    if (config?.error) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: config.error }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          authUrl: `https://mock-oauth.test/${provider}/authorize`,
        },
      }),
    });
  });
}

export async function mockDashboardData(page: Page): Promise<void> {
  const emptyList = { data: [] };

  await page.route('**/api/tasks**', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(emptyList),
    });
  });

  await page.route('**/api/projects**', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(emptyList),
    });
  });

  await page.route('**/api/initiatives**', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(emptyList),
    });
  });

  await page.route('**/api/events**', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(emptyList),
    });
  });
}

export async function clearAuthState(context: BrowserContext): Promise<void> {
  await context.clearCookies();
}
