/**
 * Onboarding AI service.
 *
 * Drives the onboarding experience through AI-powered conversation.
 * Athena leads the flow, using tools to gather information and
 * make decisions about what to show the user.
 *
 * @packageDocumentation
 */

import type { ChatMessage, StreamChunk, ToolCall } from '../ai/types.js';
import { getAIService } from '../ai/service.js';
import { ONBOARDING_TOOLS, executeOnboardingTool, type OnboardingToolContext } from './tools.js';
import { db } from '../../db/index.js';
import { onboardingProgress, conversations, messages } from '../../db/schema/index.js';
import { eq } from 'drizzle-orm';

/**
 * System prompt for Athena during onboarding.
 *
 * This prompt establishes Athena's personality and behavior
 * during the onboarding flow.
 */
const ONBOARDING_SYSTEM_PROMPT = `You are Athena, helping a new user set up their productivity system. You are confident, direct, and treat the user as a peer—not a customer.

YOUR ROLE:
- You're the host, guiding the conversation
- Show capability through action, not explanation
- Be efficient with words—no fluff, no excessive enthusiasm

YOUR PERSONALITY:
- Confident, not hedging or apologizing
- Direct, getting to the point
- Warm but not saccharine
- References what the user has said

NEVER SAY:
- "Great choice!" / "Awesome!" / "Perfect!"
- "I'm sorry, but..." / "I might be wrong, but..."
- "Let me help you with..." (just help, don't announce)
- "Don't worry..." (implies there was something to worry about)
- Exclamation points in every sentence

DO SAY:
- Direct acknowledgments: "Got it." / "Makes sense." / "Understood."
- Forward movement: "Let's get your calendars connected." / "Here's what I put together."
- Specific references: "Since you mentioned [X], I've..."

THE ONBOARDING FLOW:
1. INTENT - Understand why they're here (use acknowledge_intent after they share)
2. INTEGRATIONS - Connect their calendars (use get_oauth_url, check_integration_status)
3. AGENDA - Show a personalized day (use get_calendar_events, generate_time_block)

TOOLS YOU HAVE:
- acknowledge_intent: Process their intent selection and respond appropriately
- suggest_integrations: Decide which integrations to recommend
- get_oauth_url: Get the OAuth URL when they want to connect
- check_integration_status: See what's already connected
- generate_time_block: Create AI-suggested time blocks for their agenda
- get_calendar_events: See their existing calendar events
- advance_onboarding_step: Move to the next step when ready
- complete_onboarding: Finish onboarding and redirect to home

IMPORTANT BEHAVIORS:
- After user selects intent chips, call acknowledge_intent to craft your response
- When showing integrations, call suggest_integrations to prioritize
- Before generating agenda, call get_calendar_events to see their schedule
- Generate time blocks one at a time using generate_time_block
- Only call advance_onboarding_step when the user explicitly proceeds
- Only call complete_onboarding at the very end

Keep responses SHORT. 1-2 sentences max unless you're explaining something complex.`;

/**
 * Get or create an onboarding conversation.
 */
export async function getOrCreateOnboardingConversation(userId: string): Promise<string> {
  const progress = await db.query.onboardingProgress.findFirst({
    where: eq(onboardingProgress.userId, userId),
  });

  // Check if there's already a conversation ID in metadata
  const metadata = progress?.metadata as Record<string, unknown> | null;
  const existingConversationId = metadata?.conversationId;
  if (typeof existingConversationId === 'string') {
    return existingConversationId;
  }

  // Create a new conversation
  const aiService = getAIService();
  const conversationId = await aiService.createConversation(userId, 'Onboarding');

  // Store the conversation ID in onboarding progress
  const now = new Date();
  if (progress) {
    await db
      .update(onboardingProgress)
      .set({
        metadata: { ...(metadata ?? {}), conversationId },
        updatedAt: now,
      })
      .where(eq(onboardingProgress.id, progress.id));
  } else {
    await db.insert(onboardingProgress).values({
      id: crypto.randomUUID(),
      userId,
      currentStep: 'intent',
      metadata: { conversationId },
      createdAt: now,
      updatedAt: now,
    });
  }

  return conversationId;
}

/**
 * Get conversation history for onboarding.
 */
export async function getOnboardingMessages(
  userId: string,
): Promise<{ role: string; content: string }[]> {
  const conversationId = await getOrCreateOnboardingConversation(userId);

  const conversationMessages = await db.query.messages.findMany({
    where: eq(messages.conversationId, conversationId),
    orderBy: (messages, { asc }) => [asc(messages.createdAt)],
  });

  return conversationMessages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
}

/**
 * Send a message in the onboarding conversation.
 * Returns a streaming response from Athena.
 */
export async function* sendOnboardingMessage(
  userId: string,
  userMessage: string,
  baseUrl: string,
): AsyncGenerator<StreamChunk> {
  const conversationId = await getOrCreateOnboardingConversation(userId);
  const aiService = getAIService();
  const provider = aiService.getProvider();

  // Get conversation history
  const conversation = await aiService.getConversation(conversationId, userId);
  if (!conversation) {
    yield { type: 'error', error: 'Conversation not found' };
    return;
  }

  // Store user message
  await storeMessage(conversationId, 'user', userMessage);

  // Build message history
  const chatMessages: ChatMessage[] = conversation.messages.map((m) => ({
    role: m.role as ChatMessage['role'],
    content: m.content,
  }));

  chatMessages.push({ role: 'user', content: userMessage });

  // Create tool context
  const toolContext: OnboardingToolContext = {
    userId,
    baseUrl,
  };

  // Stream the response with tool calling
  let fullContent = '';
  const allToolCalls: ToolCall[] = [];

  for await (const chunk of provider.chatStream({
    messages: chatMessages,
    systemPrompt: ONBOARDING_SYSTEM_PROMPT,
    tools: ONBOARDING_TOOLS,
    temperature: 0.7,
    userId,
  })) {
    if (chunk.type === 'content') {
      fullContent += chunk.content ?? '';
    } else if (chunk.type === 'done' && chunk.fullResponse) {
      allToolCalls.push(...chunk.fullResponse.toolCalls);
    }

    yield chunk;
  }

  // Handle tool calls
  if (allToolCalls.length > 0) {
    // Execute tool calls
    const toolResults = await Promise.all(
      allToolCalls.map((tc) => executeOnboardingTool(tc, toolContext)),
    );

    // Store assistant message with tool calls
    await storeMessage(conversationId, 'assistant', fullContent, { toolCalls: allToolCalls });

    // Add tool results to message history
    for (const [i, tc] of allToolCalls.entries()) {
      const result = toolResults[i];
      if (!result) continue;

      // Yield tool results for the client to handle
      yield {
        type: 'tool_call',
        toolCall: {
          id: tc.id,
          name: tc.name,
          arguments: { ...tc.arguments, _result: result.result },
        },
      };

      chatMessages.push({
        role: 'assistant',
        content: fullContent,
      });

      chatMessages.push({
        role: 'tool',
        content: JSON.stringify(result.result ?? { error: result.error }),
        toolCallId: tc.id,
        toolName: tc.name,
      });
    }

    // Get follow-up response after tool execution
    fullContent = '';
    for await (const chunk of provider.chatStream({
      messages: chatMessages,
      systemPrompt: ONBOARDING_SYSTEM_PROMPT,
      tools: ONBOARDING_TOOLS,
      temperature: 0.7,
      userId,
    })) {
      if (chunk.type === 'content') {
        fullContent += chunk.content ?? '';
      }
      yield chunk;
    }
  }

  // Store final response
  if (fullContent) {
    await storeMessage(conversationId, 'assistant', fullContent);
  }

  // Update conversation timestamp
  await db
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));
}

/**
 * Generate the initial greeting for onboarding.
 */
export async function* generateOnboardingGreeting(
  userId: string,
  userName: string | null,
): AsyncGenerator<StreamChunk> {
  const conversationId = await getOrCreateOnboardingConversation(userId);
  const aiService = getAIService();
  const provider = aiService.getProvider();

  // Check if there are already messages
  const existingMessages = await db.query.messages.findMany({
    where: eq(messages.conversationId, conversationId),
  });

  if (existingMessages.length > 0) {
    // Return the last assistant message
    const lastAssistant = existingMessages.filter((m) => m.role === 'assistant').pop();

    if (lastAssistant) {
      yield { type: 'content', content: lastAssistant.content };
      yield { type: 'done' };
      return;
    }
  }

  // Generate fresh greeting
  const greetingPrompt = userName
    ? `Generate a short (under 15 words) greeting for ${userName} who is starting onboarding. Ask what brings them to Athena.`
    : 'Generate a short (under 15 words) greeting for a new user starting onboarding. Ask what brings them to Athena.';

  let greeting = '';

  for await (const chunk of provider.chatStream({
    messages: [{ role: 'user', content: greetingPrompt }],
    systemPrompt: ONBOARDING_SYSTEM_PROMPT,
    temperature: 0.7,
    userId,
  })) {
    if (chunk.type === 'content') {
      greeting += chunk.content ?? '';
      yield chunk;
    } else {
      yield chunk;
    }
  }

  // Store the greeting
  if (greeting) {
    await storeMessage(conversationId, 'assistant', greeting);
  }
}

/**
 * Store a message in the database.
 */
async function storeMessage(
  conversationId: string,
  role: 'user' | 'assistant' | 'system' | 'tool',
  content: string,
  metadata?: object,
): Promise<string> {
  const id = crypto.randomUUID();

  await db.insert(messages).values({
    id,
    conversationId,
    role,
    content,
    metadata: metadata ?? null,
    createdAt: new Date(),
  });

  return id;
}

/**
 * Agenda generation chunk types.
 */
export type AgendaChunk =
  | { type: 'block'; block: TimeBlock }
  | { type: 'done'; totalBlocks: number };

interface TimeBlock {
  type: 'time_block';
  source: 'ai' | 'calendar';
  title: string;
  description?: string;
  startTime: string;
  endTime: string;
  color?: string;
}

interface UserIntent {
  selectedChips: string[];
  customText: string | null;
}

/**
 * Generate a personalized agenda for a user.
 *
 * Reuses the existing tool infrastructure to:
 * 1. Fetch calendar events for the date
 * 2. Calculate free time slots
 * 3. Generate AI-suggested time blocks around existing events
 *
 * @param userId - The user's ID
 * @param date - The date to generate agenda for (YYYY-MM-DD)
 * @param intent - Optional user intent from onboarding
 */
export async function* generateAgendaForUser(
  userId: string,
  date: string,
  intent?: UserIntent,
): AsyncGenerator<AgendaChunk> {
  // Execute get_calendar_events tool to fetch events and free slots
  const toolResult = await executeOnboardingTool(
    {
      id: 'agenda-events',
      name: 'get_calendar_events',
      arguments: { date },
    },
    { userId, baseUrl: '' },
  );

  const calendarData = toolResult.result as {
    events: {
      id: string;
      title: string;
      startTime: string;
      endTime: string | null;
      isAllDay: boolean;
    }[];
    freeSlots: {
      startTime: string;
      endTime: string;
      durationMinutes: number;
    }[];
  } | null;

  const existingEvents = calendarData?.events ?? [];
  const freeSlots = calendarData?.freeSlots ?? [];
  const chips = intent?.selectedChips ?? [];
  const blocks: TimeBlock[] = [];

  // First, yield existing calendar events as blocks
  for (const event of existingEvents) {
    if (!event.isAllDay && event.endTime) {
      const block: TimeBlock = {
        type: 'time_block',
        source: 'calendar',
        title: event.title,
        startTime: event.startTime,
        endTime: event.endTime,
        color: '#3b82f6', // Blue for calendar events
      };
      blocks.push(block);
      yield { type: 'block', block };
    }
  }

  // Generate AI-suggested blocks for free slots based on intent
  for (const slot of freeSlots) {
    const slotDuration = slot.durationMinutes;

    // Skip slots that are too short
    if (slotDuration < 30) continue;

    // Determine what type of block to suggest based on intent and time
    const startHour = new Date(slot.startTime).getHours();
    const suggestedBlock = suggestBlockForSlot(slot, startHour, slotDuration, chips);

    if (suggestedBlock) {
      blocks.push(suggestedBlock);
      yield { type: 'block', block: suggestedBlock };
    }
  }

  yield { type: 'done', totalBlocks: blocks.length };
}

/**
 * Suggest a time block for a given free slot based on context.
 */
function suggestBlockForSlot(
  slot: { startTime: string; endTime: string; durationMinutes: number },
  startHour: number,
  duration: number,
  chips: string[],
): TimeBlock | null {
  // Morning slots (before 12pm) - suggest focus work
  if (startHour < 12 && duration >= 60) {
    if (chips.includes('focus') || chips.includes('projects')) {
      return {
        type: 'time_block',
        source: 'ai',
        title: 'Deep Work',
        description: 'Focused time for important tasks',
        startTime: slot.startTime,
        endTime: duration > 120 ? adjustEndTime(slot.startTime, 120) : slot.endTime,
        color: '#8b5cf6', // Purple for focus
      };
    }
  }

  // Around lunch (11-13) - suggest break if long enough
  if (startHour >= 11 && startHour <= 13 && duration >= 30) {
    return {
      type: 'time_block',
      source: 'ai',
      title: 'Lunch Break',
      startTime: slot.startTime,
      endTime: duration > 60 ? adjustEndTime(slot.startTime, 60) : slot.endTime,
      color: '#22c55e', // Green for breaks
    };
  }

  // Afternoon (13-17) - suggest project work or admin
  if (startHour >= 13 && startHour < 17 && duration >= 45) {
    if (chips.includes('projects')) {
      return {
        type: 'time_block',
        source: 'ai',
        title: 'Project Work',
        description: 'Make progress on active projects',
        startTime: slot.startTime,
        endTime: duration > 120 ? adjustEndTime(slot.startTime, 120) : slot.endTime,
        color: '#06b6d4', // Cyan for projects
      };
    }
    if (chips.includes('organized')) {
      return {
        type: 'time_block',
        source: 'ai',
        title: 'Admin & Organization',
        description: 'Clear inbox, organize tasks',
        startTime: slot.startTime,
        endTime: duration > 60 ? adjustEndTime(slot.startTime, 60) : slot.endTime,
        color: '#f59e0b', // Amber for admin
      };
    }
  }

  // Late afternoon (17+) - suggest review
  if (startHour >= 17 && duration >= 30) {
    return {
      type: 'time_block',
      source: 'ai',
      title: 'Daily Review',
      description: 'Review progress and plan tomorrow',
      startTime: slot.startTime,
      endTime: duration > 30 ? adjustEndTime(slot.startTime, 30) : slot.endTime,
      color: '#6366f1', // Indigo for planning
    };
  }

  // Default: suggest focus time for longer slots
  if (duration >= 60) {
    return {
      type: 'time_block',
      source: 'ai',
      title: 'Focus Time',
      startTime: slot.startTime,
      endTime: duration > 90 ? adjustEndTime(slot.startTime, 90) : slot.endTime,
      color: '#8b5cf6',
    };
  }

  return null;
}

/**
 * Adjust end time by adding minutes to start time.
 */
function adjustEndTime(startTime: string, minutes: number): string {
  const start = new Date(startTime);
  start.setMinutes(start.getMinutes() + minutes);
  return start.toISOString();
}
