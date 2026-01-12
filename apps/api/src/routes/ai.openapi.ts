/**
 * AI/Chat OpenAPI route definitions.
 *
 * @packageDocumentation
 */

import { createRoute } from '@hono/zod-openapi';
import {
  ConversationIdParamSchema,
  ConversationsQuerySchema,
  CreateConversationRequestSchema,
  ChatRequestSchema,
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
import { z } from '@hono/zod-openapi';

// =============================================================================
// List Conversations
// =============================================================================

export const listConversations = createRoute({
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

export const createConversation = createRoute({
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

export const getConversation = createRoute({
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

export const deleteConversation = createRoute({
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

export const generateTitle = createRoute({
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

export const chat = createRoute({
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

export const chatStream = createRoute({
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

export const quickChat = createRoute({
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

export const getPreferences = createRoute({
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

export const updatePreferences = createRoute({
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

export const listProviders = createRoute({
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

export const healthCheck = createRoute({
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
