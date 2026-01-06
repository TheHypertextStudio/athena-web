/**
 * AI/Athena schema for conversations, messages, and tool executions.
 *
 * @packageDocumentation
 */

import { pgTable, text, timestamp, jsonb, pgEnum, integer } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './auth.js';

// ============================================================================
// Enums
// ============================================================================

export const messageRoleEnum = pgEnum('message_role', ['user', 'assistant', 'system', 'tool']);
export const conversationStatusEnum = pgEnum('conversation_status', ['active', 'archived']);

// ============================================================================
// Tables
// ============================================================================

/**
 * Conversations - Chat sessions with the Athena AI assistant.
 */
export const conversations = pgTable('conversations', {
  id: text('id').primaryKey(),
  title: text('title'),
  status: conversationStatusEnum('status').notNull().default('active'),
  /** Conversation context/summary for long conversations */
  summary: text('summary'),
  /** Total token count for the conversation */
  totalTokens: integer('total_tokens').notNull().default(0),
  /** The LLM provider used for this conversation */
  provider: text('provider'),
  /** The model used for this conversation */
  model: text('model'),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/**
 * Messages - Individual messages within a conversation.
 */
export const messages = pgTable('messages', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  role: messageRoleEnum('role').notNull(),
  content: text('content').notNull(),
  /** Token count for this message */
  tokenCount: integer('token_count'),
  /** Tool call ID if this is a tool response */
  toolCallId: text('tool_call_id'),
  /** Name of the tool if this is a tool response */
  toolName: text('tool_name'),
  /** Metadata about the message (e.g., model info, latency) */
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/**
 * Tool Calls - AI assistant requests to execute tools.
 */
export const toolCalls = pgTable('tool_calls', {
  id: text('id').primaryKey(),
  messageId: text('message_id')
    .notNull()
    .references(() => messages.id, { onDelete: 'cascade' }),
  toolName: text('tool_name').notNull(),
  /** Arguments passed to the tool as JSON */
  arguments: jsonb('arguments').notNull(),
  /** Result of the tool execution as JSON */
  result: jsonb('result'),
  /** Error if the tool execution failed */
  error: text('error'),
  /** Execution time in milliseconds */
  executionTimeMs: integer('execution_time_ms'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/**
 * AI Preferences - User-specific AI behavior preferences.
 */
export const aiPreferences = pgTable('ai_preferences', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** Preferred LLM provider */
  preferredProvider: text('preferred_provider'),
  /** Preferred model within the provider */
  preferredModel: text('preferred_model'),
  /** Custom system prompt additions */
  customSystemPrompt: text('custom_system_prompt'),
  /** Temperature setting (0-2) */
  temperature: text('temperature'),
  /** Maximum tokens per response */
  maxTokens: integer('max_tokens'),
  /** Whether to enable streaming responses */
  streamingEnabled: text('streaming_enabled'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ============================================================================
// Relations
// ============================================================================

export const conversationRelations = relations(conversations, ({ one, many }) => ({
  user: one(users, {
    fields: [conversations.userId],
    references: [users.id],
  }),
  messages: many(messages),
}));

export const messageRelations = relations(messages, ({ one, many }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  toolCalls: many(toolCalls),
}));

export const toolCallRelations = relations(toolCalls, ({ one }) => ({
  message: one(messages, {
    fields: [toolCalls.messageId],
    references: [messages.id],
  }),
}));

export const aiPreferencesRelations = relations(aiPreferences, ({ one }) => ({
  user: one(users, {
    fields: [aiPreferences.userId],
    references: [users.id],
  }),
}));
