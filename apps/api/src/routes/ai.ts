/**
 * AI/Athena chat routes.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { requireAuth, getUserId } from '../middleware/auth.js';
import { requireEntitlement } from '../middleware/entitlements.js';
import { getAIService } from '../services/ai/index.js';
import type { AIProvider } from '../services/ai/types.js';

const aiRoutes = new Hono();

// Require authentication for all routes
aiRoutes.use('*', requireAuth);

// Require 'ai_features' entitlement for mutating operations (POST/PUT/DELETE)
// GET requests pass through (read access is sacred)
aiRoutes.use('*', requireEntitlement('ai_features'));

const DEFAULT_AI_LIST_LIMIT = 20;
const ERROR_CONVERSATION_NOT_FOUND = 'Conversation not found';
const ERROR_CHAT_REQUIRED = 'conversationId and message are required';
const ERROR_MESSAGE_REQUIRED = 'message is required';
const ERROR_CHAT_FAILED = 'Chat failed';
const ERROR_STREAM_FAILED = 'Stream failed';

/**
 * List conversations.
 * GET /api/ai/conversations
 */
aiRoutes.get('/conversations', async (c) => {
  const userId = getUserId(c);
  const limit = parseInt(c.req.query('limit') ?? String(DEFAULT_AI_LIST_LIMIT), 10);

  const aiService = getAIService();
  const conversations = await aiService.listConversations(userId, limit);

  return c.json({ data: conversations });
});

/**
 * Create a new conversation.
 * POST /api/ai/conversations
 */
aiRoutes.post('/conversations', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json<{ title?: string }>().catch(() => ({ title: undefined }));

  const aiService = getAIService();
  const conversationId = await aiService.createConversation(userId, body.title);

  return c.json({ data: { id: conversationId } }, 201);
});

/**
 * Get a conversation with messages.
 * GET /api/ai/conversations/:id
 */
aiRoutes.get('/conversations/:id', async (c) => {
  const userId = getUserId(c);
  const conversationId = c.req.param('id');

  const aiService = getAIService();
  const conversation = await aiService.getConversation(conversationId, userId);

  if (!conversation) {
    return c.json({ error: ERROR_CONVERSATION_NOT_FOUND }, 404);
  }

  return c.json({ data: conversation });
});

/**
 * Delete a conversation.
 * DELETE /api/ai/conversations/:id
 */
aiRoutes.delete('/conversations/:id', async (c) => {
  const userId = getUserId(c);
  const conversationId = c.req.param('id');

  const aiService = getAIService();
  const deleted = await aiService.deleteConversation(conversationId, userId);

  if (!deleted) {
    return c.json({ error: ERROR_CONVERSATION_NOT_FOUND }, 404);
  }

  return c.body(null, 204);
});

/**
 * Generate a title for a conversation.
 * POST /api/ai/conversations/:id/title
 */
aiRoutes.post('/conversations/:id/title', async (c) => {
  const userId = getUserId(c);
  const conversationId = c.req.param('id');

  const aiService = getAIService();
  const title = await aiService.generateConversationTitle(conversationId, userId);

  return c.json({ data: { title } });
});

/**
 * Send a chat message (non-streaming).
 * POST /api/ai/chat
 */
aiRoutes.post('/chat', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json<{
    conversationId: string;
    message: string;
    provider?: AIProvider;
    temperature?: number;
    maxTokens?: number;
  }>();

  if (!body.conversationId || !body.message) {
    return c.json({ error: ERROR_CHAT_REQUIRED }, 400);
  }

  const aiService = getAIService();

  try {
    const result = await aiService.chat(body.conversationId, userId, body.message, {
      provider: body.provider,
      temperature: body.temperature,
      maxTokens: body.maxTokens,
    });

    return c.json({
      data: {
        response: result.response,
        toolCalls: result.toolCalls,
        usage: result.usage,
      },
    });
  } catch {
    return c.json({ error: ERROR_CHAT_FAILED }, 500);
  }
});

/**
 * Send a chat message (streaming).
 * POST /api/ai/chat/stream
 */
aiRoutes.post('/chat/stream', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json<{
    conversationId: string;
    message: string;
    provider?: AIProvider;
    temperature?: number;
    maxTokens?: number;
  }>();

  if (!body.conversationId || !body.message) {
    return c.json({ error: ERROR_CHAT_REQUIRED }, 400);
  }

  const aiService = getAIService();

  return stream(c, async (streamWriter) => {
    try {
      for await (const chunk of aiService.chatStream(body.conversationId, userId, body.message, {
        provider: body.provider,
        temperature: body.temperature,
        maxTokens: body.maxTokens,
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
aiRoutes.post('/quick', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json<{
    message: string;
    provider?: AIProvider;
  }>();

  if (!body.message) {
    return c.json({ error: ERROR_MESSAGE_REQUIRED }, 400);
  }

  const aiService = getAIService();

  try {
    // Create a temporary conversation
    const conversationId = await aiService.createConversation(userId);

    const result = await aiService.chat(conversationId, userId, body.message, {
      provider: body.provider,
    });

    // Generate title based on first message
    const title = await aiService.generateConversationTitle(conversationId, userId);

    return c.json({
      data: {
        conversationId,
        title,
        response: result.response,
        toolCalls: result.toolCalls,
        usage: result.usage,
      },
    });
  } catch {
    return c.json({ error: ERROR_CHAT_FAILED }, 500);
  }
});

/**
 * Get AI preferences.
 * GET /api/ai/preferences
 */
aiRoutes.get('/preferences', async (c) => {
  const userId = getUserId(c);

  const aiService = getAIService();
  const preferences = await aiService.getUserPreferences(userId);

  return c.json({ data: preferences });
});

/**
 * Update AI preferences.
 * PATCH /api/ai/preferences
 */
aiRoutes.patch('/preferences', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json<{
    preferredProvider?: string;
    preferredModel?: string;
    temperature?: number;
    maxTokens?: number;
  }>();

  const aiService = getAIService();
  await aiService.updateUserPreferences(userId, body);

  return c.json({ success: true });
});

/**
 * List available providers.
 * GET /api/ai/providers
 */
aiRoutes.get('/providers', (c) => {
  const aiService = getAIService();
  const providers = aiService.listProviders();
  const defaultProvider = aiService.getDefaultProvider();

  return c.json({
    data: {
      providers,
      default: defaultProvider,
    },
  });
});

/**
 * Health check for AI providers.
 * GET /api/ai/health
 */
aiRoutes.get('/health', async (c) => {
  const aiService = getAIService();
  const health = await aiService.healthCheck();

  return c.json({ data: health });
});

/**
 * Generate field suggestions for inline assistance.
 * POST /api/ai/completions
 *
 * This is a general-purpose endpoint for AI-native form UX.
 * Returns 1-3 suggestions based on context.
 */
aiRoutes.post('/completions', async (c) => {
  const body = await c.req.json<{
    type?: string;
    context?: {
      objectType?: 'initiative' | 'task' | 'project';
      field?: 'title' | 'description';
      values?: {
        title?: string;
        description?: string;
      };
    };
  }>();

  if (body.type !== 'field_suggestion' || !body.context) {
    return c.json({ error: 'Invalid completion type' }, 400);
  }

  const { objectType, field, values = {} } = body.context;

  if (!objectType || !field) {
    return c.json({ error: 'objectType and field are required' }, 400);
  }

  const validObjectTypes = ['initiative', 'task', 'project'];
  const validFields = ['title', 'description'];

  if (!validObjectTypes.includes(objectType)) {
    return c.json({ error: 'Invalid objectType' }, 400);
  }

  if (!validFields.includes(field)) {
    return c.json({ error: 'Invalid field' }, 400);
  }

  const aiService = getAIService();
  const completions = await aiService.generateFieldSuggestions({ objectType, field, values });

  return c.json({ completions });
});

export { aiRoutes };
