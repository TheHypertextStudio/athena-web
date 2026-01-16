/**
 * Onboarding-specific tools for Athena.
 *
 * These tools allow Athena to drive the onboarding experience,
 * making decisions about what to show and when.
 *
 * @packageDocumentation
 */

import type { ToolDefinition, ToolCall, ToolResult } from '../ai/types.js';
import { db } from '../../db/index.js';
import { onboardingProgress, events } from '../../db/schema/index.js';
import { eq, and, gte, lte } from 'drizzle-orm';
import { getCalendarSyncService } from '../calendar-sync/service.js';
import { env } from '../../lib/env.js';

/**
 * Tools available to Athena during onboarding.
 */
export const ONBOARDING_TOOLS: ToolDefinition[] = [
  {
    name: 'acknowledge_intent',
    description:
      "Acknowledge the user's stated intent and provide a personalized response. Use this after the user selects their intent chips or describes their goals.",
    parameters: {
      type: 'object',
      properties: {
        selectedChips: {
          type: 'string',
          description:
            'Comma-separated list of selected intent chips (e.g., "focus,calendars,projects")',
        },
        customText: {
          type: 'string',
          description: "User's custom description of their intent (optional)",
        },
      },
    },
  },
  {
    name: 'suggest_integrations',
    description:
      "Based on the user's intent, suggest which calendar/task integrations would be most useful. Returns a prioritized list of integration providers.",
    parameters: {
      type: 'object',
      properties: {
        intent: {
          type: 'string',
          description: "Summary of user's intent for using Athena",
        },
      },
      required: ['intent'],
    },
  },
  {
    name: 'get_oauth_url',
    description:
      'Get the OAuth authorization URL for a calendar provider. Use this when the user wants to connect a calendar.',
    parameters: {
      type: 'object',
      properties: {
        provider: {
          type: 'string',
          description: 'The calendar provider to connect',
          enum: ['google_calendar', 'outlook_calendar', 'apple_calendar'],
        },
      },
      required: ['provider'],
    },
  },
  {
    name: 'check_integration_status',
    description:
      "Check the status of a user's connected integrations. Use this to see what calendars are connected and their sync status.",
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'generate_time_block',
    description:
      "Generate a single AI-suggested time block for the user's agenda. Call this multiple times to build an agenda. The time block will be streamed to the user.",
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Title for the time block (e.g., "Deep Work", "Lunch Break")',
        },
        description: {
          type: 'string',
          description: 'Brief description of what this time is for',
        },
        startTime: {
          type: 'string',
          description: 'Start time in ISO format',
        },
        endTime: {
          type: 'string',
          description: 'End time in ISO format',
        },
        color: {
          type: 'string',
          description: 'Hex color for the time block (e.g., "#6366f1")',
        },
        blockType: {
          type: 'string',
          description: 'Type of time block',
          enum: ['focus', 'break', 'planning', 'meeting', 'personal'],
        },
      },
      required: ['title', 'startTime', 'endTime'],
    },
  },
  {
    name: 'get_calendar_events',
    description:
      "Get the user's calendar events for a specific date. Use this to understand their schedule before generating time blocks.",
    parameters: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: 'Date to get events for (YYYY-MM-DD format)',
        },
      },
      required: ['date'],
    },
  },
  {
    name: 'advance_onboarding_step',
    description:
      'Move the user to the next step in onboarding. Only use this when the current step is complete.',
    parameters: {
      type: 'object',
      properties: {
        nextStep: {
          type: 'string',
          description: 'The step to advance to',
          enum: ['integrations', 'agenda'],
        },
        metadata: {
          type: 'string',
          description: 'JSON string of metadata to save with this step transition',
        },
      },
      required: ['nextStep'],
    },
  },
  {
    name: 'complete_onboarding',
    description:
      'Mark onboarding as complete and redirect the user to the home page. Only use this after the agenda step.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
];

/**
 * Context passed to onboarding tool execution.
 */
export interface OnboardingToolContext {
  userId: string;
  baseUrl: string;
}

/**
 * Execute an onboarding tool.
 */
export async function executeOnboardingTool(
  toolCall: ToolCall,
  context: OnboardingToolContext,
): Promise<ToolResult> {
  try {
    const result = await executeToolInternal(toolCall, context);
    return {
      toolCallId: toolCall.id,
      result,
    };
  } catch (error) {
    return {
      toolCallId: toolCall.id,
      result: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function executeToolInternal(
  toolCall: ToolCall,
  context: OnboardingToolContext,
): Promise<unknown> {
  const args = toolCall.arguments;
  const { userId, baseUrl } = context;

  switch (toolCall.name) {
    case 'acknowledge_intent':
      return acknowledgeIntent(args);

    case 'suggest_integrations':
      return suggestIntegrations(args);

    case 'get_oauth_url':
      return getOAuthUrl(args, baseUrl);

    case 'check_integration_status':
      return checkIntegrationStatus(userId);

    case 'generate_time_block':
      return generateTimeBlock(args);

    case 'get_calendar_events':
      return getCalendarEvents(userId, args);

    case 'advance_onboarding_step':
      return advanceOnboardingStep(userId, args);

    case 'complete_onboarding':
      return completeOnboarding(userId);

    default:
      throw new Error(`Unknown tool: ${toolCall.name}`);
  }
}

// Tool implementations

function getString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' ? value : undefined;
}

function acknowledgeIntent(args: Record<string, unknown>): {
  acknowledged: boolean;
  suggestedResponse: string;
  suggestedProviders: string[];
} {
  const selectedChipsStr = getString(args, 'selectedChips') ?? '';
  const customText = getString(args, 'customText');

  const chips = selectedChipsStr
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);

  // Determine suggested providers based on intent
  const suggestedProviders: string[] = [];

  // Always suggest calendar providers for calendar-related intents
  if (
    chips.includes('calendars') ||
    chips.includes('focus') ||
    chips.includes('time_management') ||
    chips.includes('organization')
  ) {
    suggestedProviders.push('google_calendar', 'outlook_calendar');
  }

  // For project tracking, suggest additional integrations
  if (chips.includes('projects') || chips.includes('ai_productivity')) {
    // These would be task integrations like Linear, GitHub
    suggestedProviders.push('google_calendar'); // Still want calendar for context
  }

  // If no specific intent, default to calendar providers
  if (suggestedProviders.length === 0) {
    suggestedProviders.push('google_calendar', 'outlook_calendar');
  }

  // Generate context-aware suggested response
  let suggestedResponse = '';

  if (chips.includes('focus') && chips.includes('calendars')) {
    suggestedResponse =
      'Focus and calendar consolidation—two things that go together. Your scattered calendars are probably why focus is hard.';
  } else if (chips.includes('projects') && chips.includes('ai_productivity')) {
    suggestedResponse =
      'Project tracking with AI support. I can pull in your calendar and help you prioritize.';
  } else if (chips.includes('time_management')) {
    suggestedResponse = "Time management it is. I'll need to see your calendar to help with that.";
  } else if (customText?.toLowerCase().includes('startup')) {
    suggestedResponse =
      "Startup founder mode—product, investors, team. That's a lot of context switching. Let's get your calendars synced so I can see what you're working with.";
  } else if (customText?.toLowerCase().includes('student')) {
    suggestedResponse =
      'Balancing classes, assignments, and life. I can help you block study time around your schedule.';
  } else if (chips.length > 0) {
    suggestedResponse = "Got it. Let's get your calendars connected.";
  } else {
    suggestedResponse = 'Tell me what brings you to Athena, and I can help set things up.';
  }

  return {
    acknowledged: true,
    suggestedResponse,
    suggestedProviders: [...new Set(suggestedProviders)],
  };
}

function suggestIntegrations(args: Record<string, unknown>): {
  providers: {
    provider: string;
    name: string;
    priority: number;
    reason: string;
    configured: boolean;
  }[];
} {
  const intent = getString(args, 'intent')?.toLowerCase() ?? '';

  const providers: {
    provider: string;
    name: string;
    priority: number;
    reason: string;
    configured: boolean;
  }[] = [];

  // Google Calendar - almost always relevant
  const googleConfigured = !!env.googleCalendar;
  if (
    intent.includes('calendar') ||
    intent.includes('schedule') ||
    intent.includes('focus') ||
    intent.includes('time')
  ) {
    providers.push({
      provider: 'google_calendar',
      name: 'Google Calendar',
      priority: 1,
      reason: 'Most popular calendar - likely where your meetings live',
      configured: googleConfigured,
    });
  }

  // Outlook Calendar - for work/enterprise
  const outlookConfigured = !!env.outlookCalendar;
  if (intent.includes('work') || intent.includes('meeting') || intent.includes('outlook')) {
    providers.push({
      provider: 'outlook_calendar',
      name: 'Outlook Calendar',
      priority: providers.length + 1,
      reason: 'Great for work calendars',
      configured: outlookConfigured,
    });
  }

  // Apple Calendar - for Apple ecosystem users
  if (intent.includes('apple') || intent.includes('icloud') || intent.includes('mac')) {
    providers.push({
      provider: 'apple_calendar',
      name: 'iCloud Calendar',
      priority: providers.length + 1,
      reason: 'For your Apple devices',
      configured: true, // CalDAV is always available
    });
  }

  // If no specific providers selected, default to Google and Outlook
  if (providers.length === 0) {
    providers.push(
      {
        provider: 'google_calendar',
        name: 'Google Calendar',
        priority: 1,
        reason: 'Most popular calendar',
        configured: googleConfigured,
      },
      {
        provider: 'outlook_calendar',
        name: 'Outlook Calendar',
        priority: 2,
        reason: 'For work calendars',
        configured: outlookConfigured,
      },
    );
  }

  return { providers };
}

function getOAuthUrl(
  args: Record<string, unknown>,
  baseUrl: string,
): {
  provider: string;
  authorizationUrl: string;
  configured: boolean;
} {
  const provider = getString(args, 'provider');
  if (!provider) {
    throw new Error('provider is required');
  }

  const redirectUris: Record<string, string | undefined> = {
    google_calendar: env.googleCalendar?.redirectUri,
    outlook_calendar: env.outlookCalendar?.redirectUri,
    apple_calendar: undefined, // Uses CalDAV, not OAuth
  };

  const redirectUri = redirectUris[provider] ?? `${baseUrl}/api/calendar/oauth/callback`;

  const clientIds: Record<string, string | undefined> = {
    google_calendar: env.GOOGLE_CLIENT_ID,
    outlook_calendar: env.MICROSOFT_CLIENT_ID,
    apple_calendar: undefined,
  };

  const clientId = clientIds[provider];

  // Apple Calendar uses CalDAV (app-specific passwords), not OAuth
  if (provider === 'apple_calendar') {
    return {
      provider,
      authorizationUrl: '', // Client should show CalDAV setup UI
      configured: true,
    };
  }

  if (!clientId) {
    return {
      provider,
      authorizationUrl: '',
      configured: false,
    };
  }

  const authUrls: Record<string, string> = {
    google_calendar: `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=https://www.googleapis.com/auth/calendar.readonly%20https://www.googleapis.com/auth/calendar.events&access_type=offline&prompt=consent`,
    outlook_calendar: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=Calendars.ReadWrite%20offline_access`,
  };

  return {
    provider,
    authorizationUrl: authUrls[provider] ?? '',
    configured: true,
  };
}

async function checkIntegrationStatus(userId: string): Promise<{
  connections: {
    provider: string;
    accountEmail: string | null;
    syncStatus: string | null;
    calendarCount: number;
  }[];
  hasAnyConnected: boolean;
}> {
  const calendarSyncService = getCalendarSyncService();
  const connections = await calendarSyncService.getConnections(userId);

  return {
    connections: connections.map((c) => ({
      provider: c.provider,
      accountEmail: c.accountEmail ?? null,
      syncStatus: c.lastSyncStatus ?? null,
      calendarCount: c.calendars.length,
    })),
    hasAnyConnected: connections.length > 0,
  };
}

function generateTimeBlock(args: Record<string, unknown>): {
  type: 'time_block';
  title: string;
  description: string;
  startTime: string;
  endTime: string;
  color: string;
  isAISuggested: boolean;
} {
  const title = getString(args, 'title') ?? 'Time Block';
  const description = getString(args, 'description') ?? '';
  const startTime = getString(args, 'startTime') ?? new Date().toISOString();
  const endTime = getString(args, 'endTime') ?? new Date().toISOString();
  const color = getString(args, 'color') ?? '#6366f1';
  const blockType = getString(args, 'blockType') ?? 'focus';

  // Map block types to colors if not explicitly provided
  const typeColors: Record<string, string> = {
    focus: '#6366f1', // Indigo
    break: '#10b981', // Emerald
    planning: '#f59e0b', // Amber
    meeting: '#3b82f6', // Blue
    personal: '#ec4899', // Pink
  };

  return {
    type: 'time_block',
    title,
    description,
    startTime,
    endTime,
    color: color !== '#6366f1' ? color : (typeColors[blockType] ?? '#6366f1'),
    isAISuggested: true,
  };
}

async function getCalendarEvents(
  userId: string,
  args: Record<string, unknown>,
): Promise<{
  date: string;
  events: {
    id: string;
    title: string;
    startTime: string;
    endTime: string | null;
    isAllDay: boolean;
    location: string | null;
  }[];
  freeSlots: {
    startTime: string;
    endTime: string;
    durationMinutes: number;
  }[];
}> {
  const dateStr = getString(args, 'date');
  const targetDate = dateStr ? new Date(dateStr) : new Date();
  const startOfDay = new Date(targetDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(targetDate);
  endOfDay.setHours(23, 59, 59, 999);

  const userEvents = await db.query.events.findMany({
    where: and(
      eq(events.creatorId, userId),
      gte(events.startTime, startOfDay),
      lte(events.startTime, endOfDay),
    ),
    orderBy: (events, { asc }) => [asc(events.startTime)],
  });

  // Calculate free slots (simple algorithm: gaps between events during working hours)
  const workStart = new Date(targetDate);
  workStart.setHours(9, 0, 0, 0);
  const workEnd = new Date(targetDate);
  workEnd.setHours(18, 0, 0, 0);

  const freeSlots: {
    startTime: string;
    endTime: string;
    durationMinutes: number;
  }[] = [];

  let currentTime = workStart;

  for (const event of userEvents) {
    if (event.startTime > currentTime && event.startTime < workEnd) {
      const slotEnd = event.startTime < workEnd ? event.startTime : workEnd;
      const durationMinutes = Math.floor((slotEnd.getTime() - currentTime.getTime()) / 60000);
      if (durationMinutes >= 30) {
        // Only include slots of 30min or more
        freeSlots.push({
          startTime: currentTime.toISOString(),
          endTime: slotEnd.toISOString(),
          durationMinutes,
        });
      }
    }
    if (event.endTime && event.endTime > currentTime) {
      currentTime = event.endTime;
    }
  }

  // Check for free time after last event until end of work day
  if (currentTime < workEnd) {
    const durationMinutes = Math.floor((workEnd.getTime() - currentTime.getTime()) / 60000);
    if (durationMinutes >= 30) {
      freeSlots.push({
        startTime: currentTime.toISOString(),
        endTime: workEnd.toISOString(),
        durationMinutes,
      });
    }
  }

  return {
    date: targetDate.toISOString().split('T')[0] ?? '',
    events: userEvents.map((e) => ({
      id: e.id,
      title: e.title,
      startTime: e.startTime.toISOString(),
      endTime: e.endTime?.toISOString() ?? null,
      isAllDay: e.isAllDay,
      location: e.location,
    })),
    freeSlots,
  };
}

async function advanceOnboardingStep(
  userId: string,
  args: Record<string, unknown>,
): Promise<{
  success: boolean;
  currentStep: string;
}> {
  const nextStep = getString(args, 'nextStep');
  const metadataStr = getString(args, 'metadata');

  if (!nextStep || !['integrations', 'agenda'].includes(nextStep)) {
    throw new Error('Invalid nextStep. Must be "integrations" or "agenda".');
  }

  const metadata = metadataStr ? (JSON.parse(metadataStr) as Record<string, unknown>) : undefined;

  const existing = await db.query.onboardingProgress.findFirst({
    where: eq(onboardingProgress.userId, userId),
  });

  const now = new Date();

  if (existing) {
    const existingMetadata =
      existing.metadata && typeof existing.metadata === 'object' ? existing.metadata : {};
    await db
      .update(onboardingProgress)
      .set({
        currentStep: nextStep as 'intent' | 'integrations' | 'agenda',
        metadata: metadata ? { ...existingMetadata, ...metadata } : existingMetadata,
        updatedAt: now,
      })
      .where(eq(onboardingProgress.id, existing.id));
  } else {
    await db.insert(onboardingProgress).values({
      id: crypto.randomUUID(),
      userId,
      currentStep: nextStep as 'intent' | 'integrations' | 'agenda',
      metadata: metadata ?? {},
      createdAt: now,
      updatedAt: now,
    });
  }

  return {
    success: true,
    currentStep: nextStep,
  };
}

async function completeOnboarding(userId: string): Promise<{
  success: boolean;
  redirectTo: string;
}> {
  const existing = await db.query.onboardingProgress.findFirst({
    where: eq(onboardingProgress.userId, userId),
  });

  const now = new Date();

  if (existing) {
    await db
      .update(onboardingProgress)
      .set({
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(onboardingProgress.id, existing.id));
  } else {
    await db.insert(onboardingProgress).values({
      id: crypto.randomUUID(),
      userId,
      currentStep: 'agenda',
      completedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }

  return {
    success: true,
    redirectTo: '/home',
  };
}
