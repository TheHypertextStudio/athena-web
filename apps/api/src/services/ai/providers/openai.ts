/**
 * OpenAI provider implementation using official SDK.
 *
 * @packageDocumentation
 */

import OpenAI from 'openai';
import type {
  AIProviderInterface,
  AIProviderConfig,
  ChatCompletionOptions,
  ChatCompletionResponse,
  StreamChunk,
  ToolCall,
  ToolDefinition,
} from '../types.js';

/**
 * OpenAI provider for GPT models using the official SDK.
 */
export class OpenAIProvider implements AIProviderInterface {
  readonly provider = 'openai' as const;
  readonly defaultModel = 'gpt-4o-mini';

  private readonly client: OpenAI;
  private readonly model: string;

  constructor(config: AIProviderConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      organization: config.organizationId,
      timeout: config.timeoutMs ?? 60000,
    });
    this.model = config.defaultModel ?? this.defaultModel;
  }

  async chat(options: ChatCompletionOptions): Promise<ChatCompletionResponse> {
    const messages = this.formatMessages(options.messages, options.systemPrompt);
    const tools = options.tools ? this.formatTools(options.tools) : undefined;

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      tools,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens,
      stop: options.stopSequences,
    });

    const choice = response.choices[0];
    if (!choice) {
      throw new Error('No response from OpenAI');
    }

    const toolCalls: ToolCall[] = (choice.message.tool_calls ?? [])
      .filter(
        (
          tc,
        ): tc is { id: string; type: 'function'; function: { name: string; arguments: string } } =>
          tc.type === 'function' && 'function' in tc,
      )
      .map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
      }));

    return {
      content: choice.message.content ?? '',
      toolCalls,
      usage: {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
      },
      model: response.model,
      finishReason: this.mapFinishReason(choice.finish_reason),
    };
  }

  async *chatStream(options: ChatCompletionOptions): AsyncGenerator<StreamChunk> {
    const messages = this.formatMessages(options.messages, options.systemPrompt);
    const tools = options.tools ? this.formatTools(options.tools) : undefined;

    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages,
      tools,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens,
      stop: options.stopSequences,
      stream: true,
    });

    let fullContent = '';
    const pendingToolCalls = new Map<number, { id: string; name: string; arguments: string }>();

    try {
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          fullContent += delta.content;
          yield { type: 'content', content: delta.content };
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const existing = pendingToolCalls.get(tc.index) ?? { id: '', name: '', arguments: '' };
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name = tc.function.name;
            if (tc.function?.arguments) existing.arguments += tc.function.arguments;
            pendingToolCalls.set(tc.index, existing);
          }
        }

        // Check for finish reason
        const finishReason = chunk.choices[0]?.finish_reason;
        if (finishReason) {
          const toolCalls: ToolCall[] = [];
          for (const tc of pendingToolCalls.values()) {
            try {
              toolCalls.push({
                id: tc.id,
                name: tc.name,
                arguments: JSON.parse(tc.arguments) as Record<string, unknown>,
              });
            } catch {
              // Invalid JSON in tool arguments
            }
          }

          yield {
            type: 'done',
            fullResponse: {
              content: fullContent,
              toolCalls,
              usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
              model: this.model,
              finishReason: this.mapFinishReason(finishReason),
            },
          };
        }
      }
    } catch (error) {
      yield { type: 'error', error: error instanceof Error ? error.message : 'Stream error' };
    }
  }

  countTokens(text: string): Promise<number> {
    // Rough estimate: ~4 characters per token for English text
    // For accurate counting, use tiktoken library
    return Promise.resolve(Math.ceil(text.length / 4));
  }

  async listModels(): Promise<string[]> {
    const response = await this.client.models.list();
    return response.data
      .map((m: { id: string }) => m.id)
      .filter((id: string) => id.startsWith('gpt-'))
      .sort();
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.models.list();
      return true;
    } catch {
      return false;
    }
  }

  private formatMessages(
    messages: ChatCompletionOptions['messages'],
    systemPrompt?: string,
  ): OpenAI.ChatCompletionMessageParam[] {
    const formatted: OpenAI.ChatCompletionMessageParam[] = [];

    if (systemPrompt) {
      formatted.push({ role: 'system', content: systemPrompt });
    }

    for (const msg of messages) {
      if (msg.role === 'tool') {
        formatted.push({
          role: 'tool',
          content: msg.content,
          tool_call_id: msg.toolCallId ?? '',
        });
      } else if (msg.role === 'system') {
        formatted.push({ role: 'system', content: msg.content });
      } else if (msg.role === 'assistant') {
        formatted.push({ role: 'assistant', content: msg.content });
      } else {
        formatted.push({ role: 'user', content: msg.content });
      }
    }

    return formatted;
  }

  private formatTools(tools: ToolDefinition[]): OpenAI.ChatCompletionTool[] {
    return tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  private mapFinishReason(reason: string): ChatCompletionResponse['finishReason'] {
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'length':
        return 'length';
      case 'tool_calls':
        return 'tool_calls';
      case 'content_filter':
        return 'content_filter';
      default:
        return 'stop';
    }
  }
}
