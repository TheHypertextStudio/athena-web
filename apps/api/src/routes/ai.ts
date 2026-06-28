/**
 * AI/Athena chat routes.
 *
 * @packageDocumentation
 */

import { createRoute, z } from '@hono/zod-openapi';
import { stream } from 'hono/streaming';
import {
  ConversationIdParamSchema,
  ConversationsQuerySchema,
  CreateConversationRequestSchema,
  ChatRequestSchema,
  type ChatRequest,
  QuickChatRequestSchema,
  UpdateAIPreferencesRequestSchema,
  ConversationsResponseSchema,
  ConversationResponseSchema,
  CreateConversationResponseSchema,
  GenerateTitleResponseSchema,
  ChatResponseSchema,
  QuickChatResponseSchema,
  AIPreferencesResponseSchema,
  ProvidersResponseSchema,
  AIHealthResponseSchema,
} from '@athena/types/openapi/ai';
import {
  NotFoundErrorSchema,
  UnauthorizedErrorSchema,
  ErrorResponseSchema,
} from '@athena/types/openapi/common';
import { requireAuth, getUserId } from '../middleware/auth.js';
import { requireEntitlement } from '../middleware/entitlements.js';
import { getAIService } from '../services/ai/index.js';
import type { AIProvider, ToolCall as ServiceToolCall } from '../services/ai/types.js';
import { createOpenAPIApp } from '../lib/openapi.js';
import {
  ONBOARDING_TOOLS,
  executeOnboardingTool,
  type OnboardingToolContext,
} from '../services/onboarding/tools.js';
import {
  toConversationSummary,
  toConversationWithMessages,
  toToolCalls,
  toUsage,
} from './ai/serializers.js';
import { getProviderModels } from './ai/helpers.js';
import { fieldCompletionRequestSchema, fieldCompletionResponseSchema } from './ai/schemas.js';

/**
 * System prompt for Athena during onboarding context.
 */
const ONBOARDING_SYSTEM_PROMPT = `You are Athena, helping a new user set up their productivity system. You are confident, direct, and treat the user as a peer.

YOUR ROLE:
- Guide the conversation through onboarding
- Show capability through action, not explanation
- Be efficient with words—no fluff

YOUR PERSONALITY:
- Confident, not hedging
- Direct, getting to the point
- Warm but not saccharine

NEVER SAY:
- "Great choice!" / "Awesome!" / "Perfect!"
- "I'm sorry, but..." / "I might be wrong, but..."
- "Let me help you with..."
- Exclamation points in every sentence

DO SAY:
- Direct acknowledgments: "Got it." / "Makes sense."
- Forward movement: "Let's get your calendars connected."
- Specific references: "Since you mentioned [X], I've..."

THE ONBOARDING FLOW:
1. INTENT - Understand why they're here (use acknowledge_intent)
2. INTEGRATIONS - Connect calendars (use get_oauth_url, check_integration_status)
3. AGENDA - Show a personalized day (use generate_time_block)

Keep responses SHORT. 1-2 sentences max.`;

const aiRoutes = createOpenAPIApp();

// Require authentication for all routes
aiRoutes.use('*', requireAuth);

// Require 'ai_features' entitlement for mutating operations (POST/PUT/DELETE)
// GET requests pass through (read access is sacred)
aiRoutes.use('*', requireEntitlement('ai_features'));

const ERROR_CONVERSATION_NOT_FOUND = 'Conversation not found';
const ERROR_CHAT_FAILED = 'Chat failed';
const ERROR_STREAM_FAILED = 'Stream failed';
const NOT_FOUND_ERROR = 'Not found' as const;
const ALL_PROVIDERS: AIProvider[] = ['openai', 'anthropic', 'google'];
const PROVIDER_LABELS: Record<AIProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
};

// =============================================================================
// List Conversations
// =============================================================================

const listConversations = createRoute({
  method: 'get',
  path: '/conversations',
  tags: ['AI'],
  summary: 'List conversations',
  description: 'List AI conversations for the authenticated user.',
  request: {
    query: ConversationsQuerySchema,
  },
  responses: {
    200: {
      description: 'Conversations retrieved successfully',
      content: {
        'application/json': {
          schema: ConversationsResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Create Conversation
// =============================================================================

const createConversation = createRoute({
  method: 'post',
  path: '/conversations',
  tags: ['AI'],
  summary: 'Create conversation',
  description: 'Create a new AI conversation.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateConversationRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Conversation created successfully',
      content: {
        'application/json': {
          schema: CreateConversationResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Get Conversation
// =============================================================================

const getConversation = createRoute({
  method: 'get',
  path: '/conversations/{id}',
  tags: ['AI'],
  summary: 'Get conversation',
  description: 'Get a conversation with its messages.',
  request: {
    params: ConversationIdParamSchema,
  },
  responses: {
    200: {
      description: 'Conversation retrieved successfully',
      content: {
        'application/json': {
          schema: ConversationResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
    404: {
      description: 'Conversation not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Delete Conversation
// =============================================================================

const deleteConversation = createRoute({
  method: 'delete',
  path: '/conversations/{id}',
  tags: ['AI'],
  summary: 'Delete conversation',
  description: 'Delete a conversation.',
  request: {
    params: ConversationIdParamSchema,
  },
  responses: {
    204: {
      description: 'Conversation deleted successfully',
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
    404: {
      description: 'Conversation not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Generate Title
// =============================================================================

const generateTitle = createRoute({
  method: 'post',
  path: '/conversations/{id}/title',
  tags: ['AI'],
  summary: 'Generate title',
  description: 'Generate a title for a conversation.',
  request: {
    params: ConversationIdParamSchema,
  },
  responses: {
    200: {
      description: 'Title generated successfully',
      content: {
        'application/json': {
          schema: GenerateTitleResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Chat
// =============================================================================

const chat = createRoute({
  method: 'post',
  path: '/chat',
  tags: ['AI'],
  summary: 'Send chat message',
  description: 'Send a message and get a response.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: ChatRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Chat response received',
      content: {
        'application/json': {
          schema: ChatResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid request',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
    500: {
      description: 'Chat failed',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// =============================================================================
// Chat Stream
// =============================================================================

const chatStream = createRoute({
  method: 'post',
  path: '/chat/stream',
  tags: ['AI'],
  summary: 'Send chat message (streaming)',
  description: 'Send a message and stream the response.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: ChatRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Streaming response',
      content: {
        'text/event-stream': {
          schema: z.string(),
        },
      },
    },
    400: {
      description: 'Invalid request',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Quick Chat
// =============================================================================

const quickChat = createRoute({
  method: 'post',
  path: '/quick',
  tags: ['AI'],
  summary: 'Quick chat',
  description: 'Quick chat without conversation context.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: QuickChatRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Chat response received',
      content: {
        'application/json': {
          schema: QuickChatResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid request',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
    500: {
      description: 'Chat failed',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// =============================================================================
// Get Preferences
// =============================================================================

const getPreferences = createRoute({
  method: 'get',
  path: '/preferences',
  tags: ['AI'],
  summary: 'Get AI preferences',
  description: 'Get AI preferences for the authenticated user.',
  responses: {
    200: {
      description: 'Preferences retrieved successfully',
      content: {
        'application/json': {
          schema: AIPreferencesResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Update Preferences
// =============================================================================

const updatePreferences = createRoute({
  method: 'patch',
  path: '/preferences',
  tags: ['AI'],
  summary: 'Update AI preferences',
  description: 'Update AI preferences.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: UpdateAIPreferencesRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Preferences updated successfully',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true) }),
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// List Providers
// =============================================================================

const listProviders = createRoute({
  method: 'get',
  path: '/providers',
  tags: ['AI'],
  summary: 'List AI providers',
  description: 'List available AI providers.',
  responses: {
    200: {
      description: 'Providers retrieved successfully',
      content: {
        'application/json': {
          schema: ProvidersResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Health Check
// =============================================================================

const healthCheck = createRoute({
  method: 'get',
  path: '/health',
  tags: ['AI'],
  summary: 'AI health check',
  description: 'Check AI provider health.',
  responses: {
    200: {
      description: 'Health status retrieved',
      content: {
        'application/json': {
          schema: AIHealthResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Field Completions
// =============================================================================

const generateCompletions = createRoute({
  method: 'post',
  path: '/completions',
  tags: ['AI'],
  summary: 'Generate field completions',
  description: 'Generate field suggestions for AI-native form UX.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: fieldCompletionRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Completions generated',
      content: {
        'application/json': {
          schema: fieldCompletionResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid completion request',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

/**
 * List conversations.
 * GET /api/ai/conversations
 */
aiRoutes.openapi(listConversations, async (c) => {
  const userId = getUserId(c);
  const { limit } = c.req.valid('query');

  const aiService = getAIService();
  const conversations = await aiService.listConversations(userId, limit);

  return c.json({ data: conversations.map(toConversationSummary) }, 200);
});

/**
 * Create a new conversation.
 * POST /api/ai/conversations
 */
aiRoutes.openapi(createConversation, async (c) => {
  const userId = getUserId(c);
  const body = c.req.valid('json');

  const aiService = getAIService();
  const conversationId = await aiService.createConversation(userId, body.title);

  return c.json({ data: { id: conversationId } }, 201);
});

/**
 * Get a conversation with messages.
 * GET /api/ai/conversations/:id
 */
aiRoutes.openapi(getConversation, async (c) => {
  const userId = getUserId(c);
  const { id: conversationId } = c.req.valid('param');

  const aiService = getAIService();
  const conversation = await aiService.getConversation(conversationId, userId);

  if (!conversation) {
    return c.json({ error: NOT_FOUND_ERROR, message: ERROR_CONVERSATION_NOT_FOUND }, 404);
  }

  return c.json({ data: toConversationWithMessages(conversation) }, 200);
});

/**
 * Delete a conversation.
 * DELETE /api/ai/conversations/:id
 */
aiRoutes.openapi(deleteConversation, async (c) => {
  const userId = getUserId(c);
  const { id: conversationId } = c.req.valid('param');

  const aiService = getAIService();
  const deleted = await aiService.deleteConversation(conversationId, userId);

  if (!deleted) {
    return c.json({ error: NOT_FOUND_ERROR, message: ERROR_CONVERSATION_NOT_FOUND }, 404);
  }

  return c.body(null, 204);
});

/**
 * Generate a title for a conversation.
 * POST /api/ai/conversations/:id/title
 */
aiRoutes.openapi(generateTitle, async (c) => {
  const userId = getUserId(c);
  const { id: conversationId } = c.req.valid('param');

  const aiService = getAIService();
  const title = await aiService.generateConversationTitle(conversationId, userId);

  return c.json({ data: { title } }, 200);
});

/**
 * Send a chat message (non-streaming).
 * POST /api/ai/chat
 */
aiRoutes.openapi(chat, async (c) => {
  const userId = getUserId(c);
  const body: ChatRequest = c.req.valid('json');

  const aiService = getAIService();

  // Build context-specific options
  const protocol = c.req.header('x-forwarded-proto') ?? 'http';
  const host = c.req.header('host') ?? 'localhost:8787';
  const baseUrl = `${protocol}://${host}`;
  const toolContext: OnboardingToolContext = { userId, baseUrl };

  const contextOptions =
    body.context === 'onboarding'
      ? {
          systemPrompt: ONBOARDING_SYSTEM_PROMPT,
          tools: ONBOARDING_TOOLS,
          toolExecutor: async (tc: ServiceToolCall) => {
            const result = await executeOnboardingTool(tc, toolContext);
            return { result: result.result, error: result.error };
          },
        }
      : {};

  try {
    const result = await aiService.chat(body.conversationId, userId, body.message, {
      provider: body.provider,
      temperature: body.temperature,
      maxTokens: body.maxTokens,
      ...contextOptions,
    });

    return c.json(
      {
        data: {
          response: result.response,
          toolCalls: toToolCalls(result.toolCalls),
          usage: toUsage(result.usage),
        },
      },
      200,
    );
  } catch {
    return c.json({ error: ERROR_CHAT_FAILED }, 500);
  }
});

/**
 * Send a chat message (streaming).
 * POST /api/ai/chat/stream
 */
aiRoutes.openapi(chatStream, (c) => {
  const userId = getUserId(c);
  const body: ChatRequest = c.req.valid('json');

  const aiService = getAIService();

  // Build context-specific options
  const protocol = c.req.header('x-forwarded-proto') ?? 'http';
  const host = c.req.header('host') ?? 'localhost:8787';
  const baseUrl = `${protocol}://${host}`;
  const toolContext: OnboardingToolContext = { userId, baseUrl };

  const contextOptions =
    body.context === 'onboarding'
      ? {
          systemPrompt: ONBOARDING_SYSTEM_PROMPT,
          tools: ONBOARDING_TOOLS,
          toolExecutor: async (tc: ServiceToolCall) => {
            const result = await executeOnboardingTool(tc, toolContext);
            return { result: result.result, error: result.error };
          },
        }
      : {};

  return stream(c, async (streamWriter) => {
    try {
      for await (const chunk of aiService.chatStream(body.conversationId, userId, body.message, {
        provider: body.provider,
        temperature: body.temperature,
        maxTokens: body.maxTokens,
        ...contextOptions,
      })) {
        await streamWriter.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
    } catch {
      await streamWriter.write(
        `data: ${JSON.stringify({ type: 'error', error: ERROR_STREAM_FAILED })}\n\n`,
      );
    }
  });
});

/**
 * Quick chat without conversation context.
 * POST /api/ai/quick
 */
aiRoutes.openapi(quickChat, async (c) => {
  const userId = getUserId(c);
  const body = c.req.valid('json');

  const aiService = getAIService();

  try {
    // Create a temporary conversation
    const conversationId = await aiService.createConversation(userId);

    const result = await aiService.chat(conversationId, userId, body.message, {
      provider: body.provider,
    });

    // Generate title based on first message
    const title = await aiService.generateConversationTitle(conversationId, userId);

    return c.json(
      {
        data: {
          conversationId,
          title,
          response: result.response,
          toolCalls: toToolCalls(result.toolCalls),
          usage: toUsage(result.usage),
        },
      },
      200,
    );
  } catch {
    return c.json({ error: ERROR_CHAT_FAILED }, 500);
  }
});

/**
 * Get AI preferences.
 * GET /api/ai/preferences
 */
aiRoutes.openapi(getPreferences, async (c) => {
  const userId = getUserId(c);

  const aiService = getAIService();
  const preferences = await aiService.getUserPreferences(userId);
  const data = preferences ?? {
    preferredProvider: null,
    preferredModel: null,
    temperature: null,
    maxTokens: null,
  };

  return c.json({ data }, 200);
});

/**
 * Update AI preferences.
 * PATCH /api/ai/preferences
 */
aiRoutes.openapi(updatePreferences, async (c) => {
  const userId = getUserId(c);
  const body = c.req.valid('json');

  const aiService = getAIService();
  await aiService.updateUserPreferences(userId, body);

  return c.json({ success: true as const }, 200);
});

/**
 * List available providers.
 * GET /api/ai/providers
 */
aiRoutes.openapi(listProviders, (c) => {
  const aiService = getAIService();
  const configuredProviders = new Set(aiService.listProviders());
  const defaultProvider = aiService.getDefaultProvider();

  return c.json(
    {
      data: {
        providers: ALL_PROVIDERS.map((provider) => ({
          id: provider,
          name: PROVIDER_LABELS[provider],
          models: getProviderModels(provider),
          available: configuredProviders.has(provider),
        })),
        default: defaultProvider,
      },
    },
    200,
  );
});

/**
 * Health check for AI providers.
 * GET /api/ai/health
 */
aiRoutes.openapi(healthCheck, async (c) => {
  const aiService = getAIService();
  const health = await aiService.healthCheck();

  return c.json(
    {
      data: Object.entries(health).map(([provider, healthy]) => ({
        provider,
        healthy,
      })),
    },
    200,
  );
});

/**
 * Generate field suggestions for inline assistance.
 * POST /api/ai/completions
 *
 * This is a general-purpose endpoint for AI-native form UX.
 * Returns 1-3 suggestions based on context.
 */
aiRoutes.openapi(generateCompletions, async (c) => {
  const body = c.req.valid('json');
  const { objectType, field, values = {} } = body.context;

  const aiService = getAIService();
  const completions = await aiService.generateFieldSuggestions({ objectType, field, values });

  return c.json({ completions }, 200);
});

export { aiRoutes };
