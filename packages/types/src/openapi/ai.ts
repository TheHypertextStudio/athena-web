/**
 * AI/Chat OpenAPI schemas.
 *
 * @packageDocumentation
 */

import { z } from '@hono/zod-openapi';
import { TimestampSchema, successResponseSchema } from './common.js';

// =============================================================================
// Enums
// =============================================================================

export const AIProviderSchema = z.enum(['anthropic', 'openai', 'google']).openapi({
  description: 'AI provider',
  example: 'anthropic',
});

// =============================================================================
// Core AI Schemas
// =============================================================================

export const ConversationSchema = z
  .object({
    id: z.string().openapi({ description: 'Conversation ID' }),
    userId: z.uuid().openapi({ description: 'User ID' }),
    title: z.string().nullable().openapi({ description: 'Conversation title' }),
    createdAt: TimestampSchema.openapi({ description: 'Creation timestamp' }),
    updatedAt: TimestampSchema.openapi({ description: 'Last update timestamp' }),
  })
  .openapi('Conversation');

export const MessageSchema = z
  .object({
    id: z.string().openapi({ description: 'Message ID' }),
    conversationId: z.string().openapi({ description: 'Conversation ID' }),
    role: z.enum(['user', 'assistant', 'system']).openapi({ description: 'Message role' }),
    content: z.string().openapi({ description: 'Message content' }),
    createdAt: TimestampSchema.openapi({ description: 'Creation timestamp' }),
  })
  .openapi('Message');

export const ConversationWithMessagesSchema = ConversationSchema.extend({
  messages: z.array(MessageSchema).openapi({ description: 'Conversation messages' }),
}).openapi('ConversationWithMessages');

export const ToolCallSchema = z
  .object({
    name: z.string().openapi({ description: 'Tool name' }),
    input: z.record(z.string(), z.unknown()).openapi({ description: 'Tool input' }),
    result: z.unknown().optional().openapi({ description: 'Tool result' }),
  })
  .openapi('ToolCall');

export const UsageSchema = z
  .object({
    inputTokens: z.number().int().openapi({ description: 'Input tokens used' }),
    outputTokens: z.number().int().openapi({ description: 'Output tokens used' }),
  })
  .openapi('Usage');

export const AIPreferencesSchema = z
  .object({
    preferredProvider: z.string().nullable().openapi({ description: 'Preferred AI provider' }),
    preferredModel: z.string().nullable().openapi({ description: 'Preferred model' }),
    temperature: z.number().min(0).max(2).nullable().openapi({ description: 'Temperature' }),
    maxTokens: z.number().int().positive().nullable().openapi({ description: 'Max tokens' }),
  })
  .openapi('AIPreferences');

export const ProviderInfoSchema = z
  .object({
    id: z.string().openapi({ description: 'Provider ID' }),
    name: z.string().openapi({ description: 'Provider name' }),
    models: z.array(z.string()).openapi({ description: 'Available models' }),
    available: z.boolean().openapi({ description: 'Whether provider is available' }),
  })
  .openapi('ProviderInfo');

export const ProviderHealthSchema = z
  .object({
    provider: z.string().openapi({ description: 'Provider ID' }),
    healthy: z.boolean().openapi({ description: 'Health status' }),
    latencyMs: z.number().optional().openapi({ description: 'Latency in ms' }),
    error: z.string().optional().openapi({ description: 'Error message' }),
  })
  .openapi('ProviderHealth');

// =============================================================================
// Path Parameters
// =============================================================================

export const ConversationIdParamSchema = z
  .object({
    id: z.string().openapi({
      description: 'Conversation ID',
      param: { name: 'id', in: 'path' },
    }),
  })
  .openapi('ConversationIdParam');

// =============================================================================
// Query Parameters
// =============================================================================

export const ConversationsQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .openapi({
        description: 'Maximum number of conversations to return',
        param: { name: 'limit', in: 'query' },
      }),
  })
  .openapi('ConversationsQuery');

// =============================================================================
// Request Bodies
// =============================================================================

export const CreateConversationRequestSchema = z
  .object({
    title: z.string().max(200).optional().openapi({ description: 'Conversation title' }),
  })
  .openapi('CreateConversationRequest');

export const ChatRequestSchema = z
  .object({
    conversationId: z.string().openapi({ description: 'Conversation ID' }),
    message: z.string().min(1).openapi({ description: 'User message' }),
    provider: AIProviderSchema.optional().openapi({ description: 'AI provider to use' }),
    temperature: z.number().min(0).max(2).optional().openapi({ description: 'Temperature' }),
    maxTokens: z.number().int().positive().optional().openapi({ description: 'Max tokens' }),
  })
  .openapi('ChatRequest');

export const QuickChatRequestSchema = z
  .object({
    message: z.string().min(1).openapi({ description: 'User message' }),
    provider: AIProviderSchema.optional().openapi({ description: 'AI provider to use' }),
  })
  .openapi('QuickChatRequest');

export const UpdateAIPreferencesRequestSchema = z
  .object({
    preferredProvider: z.string().optional(),
    preferredModel: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().positive().optional(),
  })
  .openapi('UpdateAIPreferencesRequest');

// =============================================================================
// Response Schemas
// =============================================================================

export const ConversationsResponseSchema = successResponseSchema(
  z.array(ConversationSchema),
  'List of conversations',
).openapi('ConversationsResponse');

export const ConversationResponseSchema = successResponseSchema(
  ConversationWithMessagesSchema,
  'Conversation with messages',
).openapi('ConversationResponse');

export const CreateConversationResponseSchema = successResponseSchema(
  z.object({ id: z.string() }),
  'Created conversation ID',
).openapi('CreateConversationResponse');

export const GenerateTitleResponseSchema = successResponseSchema(
  z.object({ title: z.string().nullable() }),
  'Generated title',
).openapi('GenerateTitleResponse');

export const ChatResponseSchema = successResponseSchema(
  z.object({
    response: z.string().openapi({ description: 'AI response' }),
    toolCalls: z.array(ToolCallSchema).optional(),
    usage: UsageSchema.optional(),
  }),
  'Chat response',
).openapi('ChatResponse');

export const QuickChatResponseSchema = successResponseSchema(
  z.object({
    conversationId: z.string(),
    title: z.string().nullable(),
    response: z.string(),
    toolCalls: z.array(ToolCallSchema).optional(),
    usage: UsageSchema.optional(),
  }),
  'Quick chat response',
).openapi('QuickChatResponse');

export const AIPreferencesResponseSchema = successResponseSchema(
  AIPreferencesSchema,
  'AI preferences',
).openapi('AIPreferencesResponse');

export const ProvidersResponseSchema = successResponseSchema(
  z.object({
    providers: z.array(ProviderInfoSchema),
    default: z.string(),
  }),
  'Available providers',
).openapi('ProvidersResponse');

export const AIHealthResponseSchema = successResponseSchema(
  z.array(ProviderHealthSchema),
  'Provider health status',
).openapi('AIHealthResponse');

// =============================================================================
// Type Exports
// =============================================================================

export type AIProvider = z.infer<typeof AIProviderSchema>;
export type Conversation = z.infer<typeof ConversationSchema>;
export type ConversationWithMessages = z.infer<typeof ConversationWithMessagesSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type ToolCall = z.infer<typeof ToolCallSchema>;
export type Usage = z.infer<typeof UsageSchema>;
export type AIPreferences = z.infer<typeof AIPreferencesSchema>;
export type ChatRequest = z.infer<typeof ChatRequestSchema>;
export type QuickChatRequest = z.infer<typeof QuickChatRequestSchema>;
