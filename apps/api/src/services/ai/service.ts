/**
 * AI service - manages LLM providers and conversation handling.
 *
 * @packageDocumentation
 */

import type {
  AIProvider,
  AIProviderInterface,
  AIProviderConfig,
  StreamChunk,
  ChatMessage,
  ToolCall,
} from './types.js';
import { DEFAULT_MODELS } from './types.js';
import { OpenAIProvider } from './providers/openai.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { ATHENA_TOOLS, executeTool } from './tools.js';
import { db } from '../../db/index.js';
import { conversations, messages, toolCalls, aiPreferences } from '../../db/schema/index.js';
import { eq, desc, and } from 'drizzle-orm';
import { notDeleted } from '../../lib/soft-delete.js';
import { env } from '../../lib/env.js';

/**
 * Configuration for the AI service.
 */
export interface AIServiceConfig {
  openai?: AIProviderConfig;
  anthropic?: AIProviderConfig;
  google?: AIProviderConfig;
  defaultProvider?: AIProvider;
}

/**
 * The Athena AI assistant system prompt.
 */
const ATHENA_SYSTEM_PROMPT = `You are Athena, an intelligent personal productivity assistant for Project Athena. Your role is to help users manage their tasks, projects, events, and time effectively.

Key capabilities:
- Create, update, and manage tasks with priorities and deadlines
- Track projects and their progress
- Manage calendar events
- Time tracking with start/stop timers
- Provide productivity insights and summaries
- Help plan the user's day and week

Guidelines:
- Be concise and helpful
- When the user asks about their tasks, projects, or schedule, use the available tools to fetch real data
- Proactively suggest organizing or prioritizing work when appropriate
- Use natural, friendly language
- When creating tasks, ask for clarification if the title is vague
- Always confirm actions that modify data (create, update, delete)
- Time estimates should be realistic and help the user plan their day

Available context:
- You can see the user's tasks, projects, events, and time tracking data
- You have tools to create, update, and manage all of these
- You can provide summaries and insights based on their data`;

/**
 * AI service for managing LLM interactions.
 */
export class AIService {
  private providers = new Map<AIProvider, AIProviderInterface>();
  private defaultProvider: AIProvider;

  constructor(config: AIServiceConfig) {
    if (config.openai) {
      this.providers.set('openai', new OpenAIProvider(config.openai));
    }

    if (config.anthropic) {
      this.providers.set('anthropic', new AnthropicProvider(config.anthropic));
    }

    // Determine default provider
    this.defaultProvider = config.defaultProvider ?? 'anthropic';

    // Fall back to any available provider
    if (!this.providers.has(this.defaultProvider)) {
      const firstProvider = this.providers.keys().next().value;
      if (firstProvider) {
        this.defaultProvider = firstProvider;
      }
    }
  }

  /**
   * Get the default provider.
   */
  getDefaultProvider(): AIProvider {
    return this.defaultProvider;
  }

  /**
   * Get a specific provider instance.
   */
  getProvider(provider?: AIProvider): AIProviderInterface {
    const targetProvider = provider ?? this.defaultProvider;
    const instance = this.providers.get(targetProvider);

    if (!instance) {
      throw new Error(`Provider ${targetProvider} is not configured`);
    }

    return instance;
  }

  /**
   * List available providers.
   */
  listProviders(): AIProvider[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Create a new conversation.
   */
  async createConversation(userId: string, title?: string): Promise<string> {
    const id = crypto.randomUUID();
    const now = new Date();

    await db.insert(conversations).values({
      id,
      title,
      userId,
      provider: this.defaultProvider,
      model: DEFAULT_MODELS[this.defaultProvider],
      createdAt: now,
      updatedAt: now,
    });

    return id;
  }

  /**
   * Get conversation history.
   */
  async getConversation(
    conversationId: string,
    userId: string,
  ): Promise<{
    id: string;
    title: string | null;
    messages: {
      id: string;
      role: string;
      content: string;
      createdAt: Date;
    }[];
  } | null> {
    const conversation = await db.query.conversations.findFirst({
      where: and(
        eq(conversations.id, conversationId),
        eq(conversations.userId, userId),
        notDeleted(conversations.deletedAt),
      ),
    });

    if (!conversation) {
      return null;
    }

    const conversationMessages = await db.query.messages.findMany({
      where: eq(messages.conversationId, conversationId),
      orderBy: [messages.createdAt],
    });

    return {
      id: conversation.id,
      title: conversation.title,
      messages: conversationMessages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
      })),
    };
  }

  /**
   * List conversations for a user.
   */
  async listConversations(
    userId: string,
    limit = 20,
  ): Promise<
    {
      id: string;
      title: string | null;
      createdAt: Date;
      updatedAt: Date;
    }[]
  > {
    const result = await db.query.conversations.findMany({
      where: and(eq(conversations.userId, userId), notDeleted(conversations.deletedAt)),
      orderBy: [desc(conversations.updatedAt)],
      limit,
    });

    return result.map((c) => ({
      id: c.id,
      title: c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }));
  }

  /**
   * Send a message and get a response (non-streaming).
   */
  async chat(
    conversationId: string,
    userId: string,
    userMessage: string,
    options?: {
      provider?: AIProvider;
      temperature?: number;
      maxTokens?: number;
    },
  ): Promise<{
    response: string;
    toolCalls: ToolCall[];
    usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
  }> {
    const provider = this.getProvider(options?.provider);

    // Get conversation history
    const conversation = await this.getConversation(conversationId, userId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }

    // Store user message
    await this.storeMessage(conversationId, 'user', userMessage);

    // Build message history
    const chatMessages: ChatMessage[] = conversation.messages.map((m) => ({
      role: m.role as ChatMessage['role'],
      content: m.content,
    }));

    // Add current user message
    chatMessages.push({ role: 'user', content: userMessage });

    // Call the AI
    let response = await provider.chat({
      messages: chatMessages,
      systemPrompt: ATHENA_SYSTEM_PROMPT,
      tools: ATHENA_TOOLS,
      temperature: options?.temperature ?? 0.7,
      maxTokens: options?.maxTokens,
      userId,
    });

    // Handle tool calls
    const allToolCalls: ToolCall[] = [];
    let iterations = 0;
    const maxIterations = 10;

    while (response.toolCalls.length > 0 && iterations < maxIterations) {
      iterations++;
      allToolCalls.push(...response.toolCalls);

      // Execute tool calls
      const toolResults = await Promise.all(
        response.toolCalls.map((tc) => executeTool(tc, userId)),
      );

      // Store assistant message with tool calls
      const assistantMessageId = await this.storeMessage(
        conversationId,
        'assistant',
        response.content,
        { toolCalls: response.toolCalls },
      );

      // Store tool call records
      for (const [i, tc] of response.toolCalls.entries()) {
        const result = toolResults[i];
        if (!result) continue;

        await db.insert(toolCalls).values({
          id: crypto.randomUUID(),
          messageId: assistantMessageId,
          toolName: tc.name,
          arguments: tc.arguments,
          result: result.result,
          error: result.error ?? null,
          createdAt: new Date(),
        });
      }

      // Add tool results to message history
      for (const [i, tc] of response.toolCalls.entries()) {
        const result = toolResults[i];
        if (!result) continue;

        chatMessages.push({
          role: 'assistant',
          content: response.content,
        });

        chatMessages.push({
          role: 'tool',
          content: JSON.stringify(result.result ?? { error: result.error }),
          toolCallId: tc.id,
          toolName: tc.name,
        });
      }

      // Call AI again with tool results
      response = await provider.chat({
        messages: chatMessages,
        systemPrompt: ATHENA_SYSTEM_PROMPT,
        tools: ATHENA_TOOLS,
        temperature: options?.temperature ?? 0.7,
        maxTokens: options?.maxTokens,
        userId,
      });
    }

    // Store final assistant response
    await this.storeMessage(conversationId, 'assistant', response.content);

    // Update conversation timestamp
    await db
      .update(conversations)
      .set({ updatedAt: new Date(), totalTokens: response.usage.totalTokens })
      .where(eq(conversations.id, conversationId));

    return {
      response: response.content,
      toolCalls: allToolCalls,
      usage: response.usage,
    };
  }

  /**
   * Send a message and stream the response.
   */
  async *chatStream(
    conversationId: string,
    userId: string,
    userMessage: string,
    options?: {
      provider?: AIProvider;
      temperature?: number;
      maxTokens?: number;
    },
  ): AsyncGenerator<StreamChunk> {
    const provider = this.getProvider(options?.provider);

    // Get conversation history
    const conversation = await this.getConversation(conversationId, userId);
    if (!conversation) {
      yield { type: 'error', error: 'Conversation not found' };
      return;
    }

    // Store user message
    await this.storeMessage(conversationId, 'user', userMessage);

    // Build message history
    const chatMessages: ChatMessage[] = conversation.messages.map((m) => ({
      role: m.role as ChatMessage['role'],
      content: m.content,
    }));

    chatMessages.push({ role: 'user', content: userMessage });

    // Stream the response
    let fullContent = '';
    const allToolCalls: ToolCall[] = [];

    for await (const chunk of provider.chatStream({
      messages: chatMessages,
      systemPrompt: ATHENA_SYSTEM_PROMPT,
      tools: ATHENA_TOOLS,
      temperature: options?.temperature ?? 0.7,
      maxTokens: options?.maxTokens,
      userId,
    })) {
      if (chunk.type === 'content') {
        fullContent += chunk.content ?? '';
      } else if (chunk.type === 'done' && chunk.fullResponse) {
        allToolCalls.push(...chunk.fullResponse.toolCalls);
      }

      yield chunk;
    }

    // If there were tool calls, we need to execute them and continue
    if (allToolCalls.length > 0) {
      // Execute tool calls
      const toolResults = await Promise.all(allToolCalls.map((tc) => executeTool(tc, userId)));

      // Store assistant message with tool calls
      const assistantMessageId = await this.storeMessage(conversationId, 'assistant', fullContent, {
        toolCalls: allToolCalls,
      });

      // Store tool call records
      for (const [i, tc] of allToolCalls.entries()) {
        const result = toolResults[i];
        if (!result) continue;

        await db.insert(toolCalls).values({
          id: crypto.randomUUID(),
          messageId: assistantMessageId,
          toolName: tc.name,
          arguments: tc.arguments,
          result: result.result,
          error: result.error ?? null,
          createdAt: new Date(),
        });
      }

      // Add tool results and continue conversation
      for (const [i, tc] of allToolCalls.entries()) {
        const result = toolResults[i];
        if (!result) continue;

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

      // Stream the follow-up response
      fullContent = '';
      for await (const chunk of provider.chatStream({
        messages: chatMessages,
        systemPrompt: ATHENA_SYSTEM_PROMPT,
        tools: ATHENA_TOOLS,
        temperature: options?.temperature ?? 0.7,
        maxTokens: options?.maxTokens,
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
      await this.storeMessage(conversationId, 'assistant', fullContent);
    }

    // Update conversation timestamp
    await db
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, conversationId));
  }

  /**
   * Generate a title for a conversation based on its content.
   */
  async generateConversationTitle(conversationId: string, userId: string): Promise<string> {
    const conversation = await this.getConversation(conversationId, userId);
    if (!conversation || conversation.messages.length === 0) {
      return 'New conversation';
    }

    const provider = this.getProvider();
    const firstMessages = conversation.messages.slice(0, 3);
    const context = firstMessages.map((m) => `${m.role}: ${m.content}`).join('\n');

    const response = await provider.chat({
      messages: [
        {
          role: 'user',
          content: `Generate a brief (2-5 word) title for this conversation:\n\n${context}\n\nTitle:`,
        },
      ],
      temperature: 0.7,
      maxTokens: 20,
    });

    const title = response.content.trim().replace(/^["']|["']$/g, '');

    // Update conversation title
    await db.update(conversations).set({ title }).where(eq(conversations.id, conversationId));

    return title;
  }

  /**
   * Delete a conversation (soft delete).
   */
  async deleteConversation(conversationId: string, userId: string): Promise<boolean> {
    const conversation = await db.query.conversations.findFirst({
      where: and(eq(conversations.id, conversationId), eq(conversations.userId, userId)),
    });

    if (!conversation) {
      return false;
    }

    await db
      .update(conversations)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(conversations.id, conversationId));

    return true;
  }

  /**
   * Get user's AI preferences.
   */
  async getUserPreferences(userId: string): Promise<{
    preferredProvider: string | null;
    preferredModel: string | null;
    temperature: number | null;
    maxTokens: number | null;
  } | null> {
    const prefs = await db.query.aiPreferences.findFirst({
      where: eq(aiPreferences.userId, userId),
    });

    if (!prefs) {
      return null;
    }

    return {
      preferredProvider: prefs.preferredProvider,
      preferredModel: prefs.preferredModel,
      temperature: prefs.temperature ? parseFloat(prefs.temperature) : null,
      maxTokens: prefs.maxTokens,
    };
  }

  /**
   * Update user's AI preferences.
   */
  async updateUserPreferences(
    userId: string,
    preferences: {
      preferredProvider?: string;
      preferredModel?: string;
      temperature?: number;
      maxTokens?: number;
    },
  ): Promise<void> {
    const existing = await db.query.aiPreferences.findFirst({
      where: eq(aiPreferences.userId, userId),
    });

    const now = new Date();

    if (existing) {
      await db
        .update(aiPreferences)
        .set({
          preferredProvider: preferences.preferredProvider,
          preferredModel: preferences.preferredModel,
          temperature: preferences.temperature?.toString(),
          maxTokens: preferences.maxTokens,
          updatedAt: now,
        })
        .where(eq(aiPreferences.id, existing.id));
    } else {
      await db.insert(aiPreferences).values({
        id: crypto.randomUUID(),
        userId,
        preferredProvider: preferences.preferredProvider ?? null,
        preferredModel: preferences.preferredModel ?? null,
        temperature: preferences.temperature?.toString() ?? null,
        maxTokens: preferences.maxTokens ?? null,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  /**
   * Generate field suggestions for an object type.
   * Used for inline AI-native form assistance.
   */
  async generateFieldSuggestions(params: {
    objectType: 'initiative' | 'task' | 'project';
    field: 'title' | 'description';
    values: {
      title?: string;
      description?: string;
    };
  }): Promise<string[]> {
    const provider = this.getProvider();
    const { objectType, field, values } = params;

    // Build context-aware prompt
    let prompt: string;

    if (field === 'title' && values.description) {
      prompt = `Generate 1-3 concise ${objectType} title suggestions based on this description. Return ONLY the titles, one per line, no numbering or bullets.\n\nDescription: "${values.description}"\n\nSuggested titles:`;
    } else if (field === 'description' && values.title) {
      prompt = `Generate 1-2 brief ${objectType} description suggestions based on this title. Return ONLY the descriptions, one per line, no numbering or bullets.\n\nTitle: "${values.title}"\n\nSuggested descriptions:`;
    } else {
      // Not enough context for suggestions
      return [];
    }

    try {
      const response = await provider.chat({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.8,
        maxTokens: 150,
      });

      // Parse the response into individual suggestions
      const suggestions = response.content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && line.length < 200)
        .slice(0, 3);

      return suggestions;
    } catch {
      // Gracefully degrade - no suggestions is fine
      return [];
    }
  }

  /**
   * Health check for configured providers.
   */
  async healthCheck(): Promise<Record<AIProvider, boolean>> {
    const results: Record<string, boolean> = {};

    for (const [provider, instance] of this.providers) {
      results[provider] = await instance.healthCheck();
    }

    return results as Record<AIProvider, boolean>;
  }

  /**
   * Store a message in the database.
   */
  private async storeMessage(
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
}

/**
 * Create an AI service from environment variables.
 */
export function createAIService(): AIService {
  const config: AIServiceConfig = {};

  // Use validated OpenAI config object
  if (env.openaiConfig) {
    config.openai = {
      apiKey: env.openaiConfig.apiKey,
      organizationId: env.openaiConfig.organizationId,
    };
  }

  // Use validated Anthropic config object
  if (env.anthropicConfig) {
    config.anthropic = {
      apiKey: env.anthropicConfig.apiKey,
    };
  }

  // Set default provider if configured
  if (env.AI_DEFAULT_PROVIDER) {
    config.defaultProvider = env.AI_DEFAULT_PROVIDER;
  }

  return new AIService(config);
}

// Singleton instance
let aiServiceInstance: AIService | null = null;

/**
 * Get the shared AI service instance.
 */
export function getAIService(): AIService {
  aiServiceInstance ??= createAIService();
  return aiServiceInstance;
}
