/**
 * Onboarding routes for the 3-step conversational onboarding flow.
 *
 * The onboarding flow is:
 * 1. Intent - Athena asks what brings the user here
 * 2. Integrations - Connect calendar and task sources
 * 3. Agenda - AI generates personalized agenda for approval
 *
 * Athena drives the conversation using tools to:
 * - Respond to user intent with personalized messages
 * - Suggest integrations based on stated goals
 * - Generate time blocks for the user's agenda
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index.js';
import { onboardingProgress, type OnboardingMetadata } from '../db/schema/index.js';
import { users } from '../db/schema/auth.js';
import { requireAuth, getUserId } from '../middleware/auth.js';
import {
  sendOnboardingMessage,
  generateOnboardingGreeting,
  getOnboardingMessages,
  generateAgendaForUser,
} from '../services/onboarding/index.js';
import { getCalendarSyncService } from '../services/calendar-sync/service.js';

const onboardingRoutes = new Hono();

onboardingRoutes.use('*', requireAuth);

/**
 * Valid onboarding steps.
 */
const ONBOARDING_STEPS = ['intent', 'integrations', 'agenda'] as const;
type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

const DEFAULT_STEP: OnboardingStep = 'intent';

/**
 * Intent chip options for the first step.
 * These are the curated options users can select from.
 */
export const INTENT_CHIPS = [
  { id: 'organized', label: 'Get more organized', icon: '📋' },
  { id: 'focus', label: 'Focus on what matters', icon: '🎯' },
  { id: 'time', label: 'Better time management', icon: '⏰' },
  { id: 'projects', label: 'Track projects', icon: '📊' },
  { id: 'calendars', label: 'Consolidate my calendars', icon: '📅' },
  { id: 'ai', label: 'AI-powered productivity', icon: '🤖' },
] as const;

// Validation schemas
const stepSchema = z.enum(ONBOARDING_STEPS);

const updateStepSchema = z.object({
  step: stepSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const generateAgendaSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD format'),
  intent: z
    .object({
      selectedChips: z.array(z.string()),
      customText: z.string().nullable(),
    })
    .optional(),
});

// Error messages
const ERROR_ONBOARDING_NOT_STARTED = 'Onboarding not started';
const ERROR_INVALID_STEP = 'Invalid onboarding step';
const ERROR_ALREADY_COMPLETED = 'Onboarding already completed';
const ERROR_ALREADY_SKIPPED = 'Onboarding already skipped';
const ERROR_ALREADY_FINISHED = 'Onboarding already finished';

/**
 * Get onboarding status for the authenticated user.
 *
 * GET /api/onboarding
 *
 * Returns the current onboarding state including step, metadata,
 * and user info (name from IdP).
 */
onboardingRoutes.get('/', async (c) => {
  const userId = getUserId(c);

  // Get user info for the response
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: {
      name: true,
      email: true,
    },
  });

  let progress = await db.query.onboardingProgress.findFirst({
    where: eq(onboardingProgress.userId, userId),
  });

  // If no progress exists, create initial record
  if (!progress) {
    const id = crypto.randomUUID();
    const now = new Date();

    await db.insert(onboardingProgress).values({
      id,
      userId,
      currentStep: DEFAULT_STEP,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    });

    progress = await db.query.onboardingProgress.findFirst({
      where: eq(onboardingProgress.userId, userId),
    });
  }

  if (!progress) {
    return c.json({ error: 'Failed to create onboarding progress' }, 500);
  }

  return c.json({
    currentStep: progress.currentStep,
    metadata: progress.metadata ?? {},
    skippedAt: progress.skippedAt?.toISOString() ?? null,
    completedAt: progress.completedAt?.toISOString() ?? null,
    user: user
      ? {
          name: user.name,
          email: user.email,
        }
      : null,
  });
});

/**
 * Update current onboarding step.
 *
 * PATCH /api/onboarding/step
 *
 * Updates the current step and merges metadata.
 * Metadata is merged, not replaced, to preserve data from previous steps.
 */
onboardingRoutes.patch('/step', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json<unknown>();

  const parsed = updateStepSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: ERROR_INVALID_STEP, details: z.treeifyError(parsed.error) }, 400);
  }

  const { step, metadata } = parsed.data;

  const existing = await db.query.onboardingProgress.findFirst({
    where: eq(onboardingProgress.userId, userId),
  });

  if (!existing) {
    return c.json({ error: ERROR_ONBOARDING_NOT_STARTED }, 404);
  }

  if (existing.completedAt || existing.skippedAt) {
    return c.json({ error: ERROR_ALREADY_FINISHED }, 400);
  }

  // Merge metadata instead of replacing
  const existingMetadata = (existing.metadata as OnboardingMetadata | null | undefined) ?? {};
  const incomingMetadata = metadata ? (metadata as Partial<OnboardingMetadata>) : undefined;
  const mergedMetadata: OnboardingMetadata = {
    ...existingMetadata,
    ...(incomingMetadata ?? {}),
  };

  // Deep merge intent if both exist
  if (existingMetadata.intent && incomingMetadata?.intent) {
    mergedMetadata.intent = {
      ...existingMetadata.intent,
      ...incomingMetadata.intent,
    };
  }

  await db
    .update(onboardingProgress)
    .set({
      currentStep: step,
      metadata: mergedMetadata,
      updatedAt: new Date(),
    })
    .where(eq(onboardingProgress.userId, userId));

  const updated = await db.query.onboardingProgress.findFirst({
    where: eq(onboardingProgress.userId, userId),
  });

  return c.json({
    currentStep: updated?.currentStep,
    metadata: updated?.metadata ?? {},
  });
});

/**
 * Complete onboarding.
 *
 * POST /api/onboarding/complete
 *
 * Marks onboarding as completed. Returns redirect URL to home.
 */
onboardingRoutes.post('/complete', async (c) => {
  const userId = getUserId(c);

  const existing = await db.query.onboardingProgress.findFirst({
    where: eq(onboardingProgress.userId, userId),
  });

  if (!existing) {
    return c.json({ error: ERROR_ONBOARDING_NOT_STARTED }, 404);
  }

  if (existing.completedAt) {
    return c.json({ error: ERROR_ALREADY_COMPLETED }, 400);
  }

  const now = new Date();

  // Update metadata with agenda approval timestamp
  const metadata = (existing.metadata as OnboardingMetadata | null | undefined) ?? {};
  metadata.agendaApprovedAt = now.toISOString();

  await db
    .update(onboardingProgress)
    .set({
      completedAt: now,
      metadata,
      updatedAt: now,
    })
    .where(eq(onboardingProgress.userId, userId));

  return c.json({
    completedAt: now.toISOString(),
    redirectTo: '/home',
  });
});

/**
 * Skip onboarding.
 *
 * POST /api/onboarding/skip
 *
 * Marks onboarding as skipped. Preserves any partial progress.
 * Returns redirect URL to home.
 */
onboardingRoutes.post('/skip', async (c) => {
  const userId = getUserId(c);

  const existing = await db.query.onboardingProgress.findFirst({
    where: eq(onboardingProgress.userId, userId),
  });

  const now = new Date();

  if (!existing) {
    // Create and immediately skip
    const id = crypto.randomUUID();

    await db.insert(onboardingProgress).values({
      id,
      userId,
      currentStep: DEFAULT_STEP,
      metadata: {},
      skippedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    return c.json({
      skippedAt: now.toISOString(),
      redirectTo: '/home',
    });
  }

  if (existing.completedAt) {
    return c.json({ error: ERROR_ALREADY_COMPLETED }, 400);
  }

  if (existing.skippedAt) {
    return c.json({ error: ERROR_ALREADY_SKIPPED }, 400);
  }

  await db
    .update(onboardingProgress)
    .set({
      skippedAt: now,
      updatedAt: now,
    })
    .where(eq(onboardingProgress.userId, userId));

  return c.json({
    skippedAt: now.toISOString(),
    redirectTo: '/home',
  });
});

/**
 * Generate personalized agenda.
 *
 * POST /api/onboarding/generate-agenda
 *
 * Generates AI-suggested time blocks based on:
 * - User's stated intent
 * - Connected calendar events
 * - Time of day preferences
 *
 * Returns a streaming SSE response with time blocks as they're generated.
 */
onboardingRoutes.post('/generate-agenda', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json<unknown>();

  const parsed = generateAgendaSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', details: z.treeifyError(parsed.error) }, 400);
  }

  const { date, intent } = parsed.data;

  // Get existing onboarding progress for intent data
  const progress = await db.query.onboardingProgress.findFirst({
    where: eq(onboardingProgress.userId, userId),
  });

  const metadata: OnboardingMetadata = progress?.metadata ?? {};
  const userIntent = intent ?? metadata.intent;

  // Delegate to service which uses existing tools infrastructure
  return streamSSE(c, async (stream) => {
    for await (const chunk of generateAgendaForUser(userId, date, userIntent)) {
      if (chunk.type === 'block') {
        await stream.writeSSE({
          event: 'block',
          data: JSON.stringify(chunk.block),
        });
      } else {
        // chunk.type === 'done'
        await stream.writeSSE({
          event: 'done',
          data: JSON.stringify({ totalBlocks: chunk.totalBlocks }),
        });
      }
    }

    // Update metadata to indicate agenda was generated
    if (progress) {
      const updatedMetadata = { ...metadata, agendaGenerated: true };
      await db
        .update(onboardingProgress)
        .set({
          metadata: updatedMetadata,
          updatedAt: new Date(),
        })
        .where(eq(onboardingProgress.userId, userId));
    }
  });
});

/**
 * Reset onboarding (for testing/support purposes).
 *
 * DELETE /api/onboarding
 */
onboardingRoutes.delete('/', async (c) => {
  const userId = getUserId(c);

  await db.delete(onboardingProgress).where(eq(onboardingProgress.userId, userId));

  return c.body(null, 204);
});

/**
 * Get available intent chips.
 *
 * GET /api/onboarding/intent-chips
 *
 * Returns the curated list of intent options for the first step.
 */
onboardingRoutes.get('/intent-chips', (c) => {
  return c.json({ chips: INTENT_CHIPS });
});

// ============================================================================
// AI Conversation Endpoints
// ============================================================================

/**
 * Get conversation messages.
 *
 * GET /api/onboarding/messages
 *
 * Returns the conversation history for the onboarding flow.
 */
onboardingRoutes.get('/messages', async (c) => {
  const userId = getUserId(c);

  try {
    const messages = await getOnboardingMessages(userId);
    return c.json({ messages });
  } catch (error) {
    console.error('Failed to get onboarding messages:', error);
    return c.json({ messages: [] });
  }
});

/**
 * Get initial greeting from Athena.
 *
 * GET /api/onboarding/greeting
 *
 * Returns a streaming greeting message from Athena.
 */
onboardingRoutes.get('/greeting', async (c) => {
  const userId = getUserId(c);

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { name: true },
  });

  return streamSSE(c, async (stream) => {
    for await (const chunk of generateOnboardingGreeting(userId, user?.name ?? null)) {
      if (chunk.type === 'content' && chunk.content) {
        await stream.writeSSE({
          event: 'content',
          data: chunk.content,
        });
      } else if (chunk.type === 'done') {
        await stream.writeSSE({
          event: 'done',
          data: '{}',
        });
      } else if (chunk.type === 'error' && chunk.error) {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ error: chunk.error }),
        });
      }
    }
  });
});

/**
 * Send a message to Athena.
 *
 * POST /api/onboarding/chat
 *
 * Sends a message to the AI and returns a streaming response.
 * Athena may use tools to:
 * - Acknowledge user intent
 * - Suggest integrations
 * - Generate time blocks
 * - Advance the onboarding step
 */
onboardingRoutes.post('/chat', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json<{ message: string }>();

  if (!body.message || typeof body.message !== 'string') {
    return c.json({ error: 'Message is required' }, 400);
  }

  // Get base URL for OAuth redirects
  const protocol = c.req.header('x-forwarded-proto') ?? 'http';
  const host = c.req.header('host') ?? 'localhost:8787';
  const baseUrl = `${protocol}://${host}`;

  return streamSSE(c, async (stream) => {
    for await (const chunk of sendOnboardingMessage(userId, body.message, baseUrl)) {
      if (chunk.type === 'content' && chunk.content) {
        await stream.writeSSE({
          event: 'content',
          data: chunk.content,
        });
      } else if (chunk.type === 'tool_call' && chunk.toolCall) {
        await stream.writeSSE({
          event: 'tool_call',
          data: JSON.stringify(chunk.toolCall),
        });
      } else if (chunk.type === 'done') {
        await stream.writeSSE({
          event: 'done',
          data: JSON.stringify(chunk.fullResponse ?? {}),
        });
      } else if (chunk.type === 'error' && chunk.error) {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ error: chunk.error }),
        });
      }
    }
  });
});

// ============================================================================
// Calendar Integration Endpoints
// ============================================================================

/**
 * Get OAuth URL for a calendar provider.
 *
 * GET /api/onboarding/calendar/oauth/:provider
 *
 * Returns the OAuth authorization URL for the specified provider.
 */
onboardingRoutes.get('/calendar/oauth/:provider', (c) => {
  const provider = c.req.param('provider');

  if (!['google', 'outlook', 'icloud'].includes(provider)) {
    return c.json({ error: 'Invalid provider' }, 400);
  }

  const calendarSyncService = getCalendarSyncService();

  // Generate a random state for CSRF protection
  const state = crypto.randomUUID();

  try {
    const authUrl = calendarSyncService.getAuthUrl(
      provider as 'google' | 'outlook' | 'icloud',
      state,
    );

    return c.json({
      provider,
      authorizationUrl: authUrl,
      state,
      configured: true,
    });
  } catch (error) {
    return c.json({
      provider,
      authorizationUrl: '',
      configured: false,
      error: error instanceof Error ? error.message : 'Provider not configured',
    });
  }
});

/**
 * Get connected calendar integrations.
 *
 * GET /api/onboarding/calendar/connections
 *
 * Returns the user's connected calendar integrations with sync status.
 */
onboardingRoutes.get('/calendar/connections', async (c) => {
  const userId = getUserId(c);

  try {
    const calendarSyncService = getCalendarSyncService();
    const connections = await calendarSyncService.getConnections(userId);

    return c.json({
      connections: connections.map((conn) => ({
        id: conn.id,
        provider: conn.provider,
        accountEmail: conn.accountEmail,
        calendarCount: conn.calendars.length,
        lastSyncAt: conn.lastSyncAt?.toISOString() ?? null,
        lastSyncStatus: conn.lastSyncStatus ?? null,
      })),
    });
  } catch (error) {
    console.error('Failed to get calendar connections:', error);
    return c.json({ connections: [] });
  }
});

/**
 * Trigger calendar sync for a connection.
 *
 * POST /api/onboarding/calendar/sync/:connectionId
 *
 * Triggers a sync for the specified calendar connection.
 */
onboardingRoutes.post('/calendar/sync/:connectionId', async (c) => {
  const userId = getUserId(c);
  const connectionId = c.req.param('connectionId');

  try {
    const calendarSyncService = getCalendarSyncService();
    const result = await calendarSyncService.sync(connectionId, userId);

    return c.json({
      success: result.success,
      eventsCreated: result.eventsCreated,
      eventsUpdated: result.eventsUpdated,
      eventsDeleted: result.eventsDeleted,
      syncedAt: result.syncedAt.toISOString(),
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Sync failed' }, 500);
  }
});

export { onboardingRoutes };
