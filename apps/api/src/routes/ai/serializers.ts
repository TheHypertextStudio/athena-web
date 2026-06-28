/**
 * AI route serializers.
 *
 * @packageDocumentation
 */

import type { MessageRole, ToolCall as ServiceToolCall } from '../../services/ai/types.js';

export interface ConversationSummary {
  id: string;
  userId: string;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  createdAt: Date;
}

export interface ConversationWithMessages extends ConversationSummary {
  messages: ConversationMessage[];
}

export function toConversationSummary(conversation: ConversationSummary) {
  return {
    id: conversation.id,
    userId: conversation.userId,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

export function toConversationMessage(message: ConversationMessage) {
  return {
    id: message.id,
    conversationId: message.conversationId,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
  };
}

export function toToolCalls(toolCalls?: ServiceToolCall[]) {
  return toolCalls?.map((toolCall) => ({
    name: toolCall.name,
    input: toolCall.arguments,
  }));
}

export function toUsage(usage?: { promptTokens: number; completionTokens: number }) {
  return usage
    ? {
        inputTokens: usage.promptTokens,
        outputTokens: usage.completionTokens,
      }
    : undefined;
}

export function toConversationWithMessages(conversation: ConversationWithMessages) {
  return {
    id: conversation.id,
    userId: conversation.userId,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messages: conversation.messages.map(toConversationMessage),
  };
}
