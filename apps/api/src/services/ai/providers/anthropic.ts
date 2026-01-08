/**
 * Anthropic provider implementation using official SDK.
 *
 * @packageDocumentation
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  AIProviderInterface,
  AIProviderConfig,
  ChatCompletionOptions,
  ChatCompletionResponse,
  StreamChunk,
  ToolCall,
  ToolDefinition,
  ChatMessage,
} from '../types.js';

/**
 * Anthropic provider for Claude models using the official SDK.
 */
export class AnthropicProvider implements AIProviderInterface {
  readonly provider = 'anthropic' as const;
  readonly defaultModel = 'claude-3-5-sonnet-20241022';

  private readonly client: Anthropic;
  private readonly model: string;

  constructor(config: AIProviderConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      timeout: config.timeoutMs ?? 60000,
    });
    this.model = config.defaultModel ?? this.defaultModel;
  }

  async chat(options: ChatCompletionOptions): Promise<ChatCompletionResponse> {
    const { messages, systemPrompt } = this.formatMessages(options.messages, options.systemPrompt);
    const tools = options.tools ? this.formatTools(options.tools) : undefined;

    const response = await this.client.messages.create({
      model: this.model,
      system: systemPrompt,
      messages,
      tools,
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature ?? 0.7,
      stop_sequences: options.stopSequences,
    });

    let content = '';
    const toolCalls: ToolCall[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        content += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        });
      }
    }

    return {
      content,
      toolCalls,
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      model: response.model,
      finishReason: this.mapStopReason(response.stop_reason ?? 'end_turn'),
    };
  }

  async *chatStream(options: ChatCompletionOptions): AsyncGenerator<StreamChunk> {
    const { messages, systemPrompt } = this.formatMessages(options.messages, options.systemPrompt);
    const tools = options.tools ? this.formatTools(options.tools) : undefined;

    const stream = this.client.messages.stream({
      model: this.model,
      system: systemPrompt,
      messages,
      tools,
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature ?? 0.7,
      stop_sequences: options.stopSequences,
    });

    let fullContent = '';
    const pendingToolCalls = new Map<number, { id: string; name: string; arguments: string }>();
    let usage = { input_tokens: 0, output_tokens: 0 };
    let currentToolIndex = 0;

    try {
      for await (const event of stream) {
        if (event.type === 'content_block_start') {
          if (event.content_block.type === 'tool_use') {
            pendingToolCalls.set(currentToolIndex, {
              id: event.content_block.id,
              name: event.content_block.name,
              arguments: '',
            });
            currentToolIndex++;
          }
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            fullContent += event.delta.text;
            yield { type: 'content', content: event.delta.text };
          } else if (event.delta.type === 'input_json_delta') {
            const tc = pendingToolCalls.get(currentToolIndex - 1);
            if (tc) {
              tc.arguments += event.delta.partial_json;
            }
          }
        } else if (event.type === 'message_delta') {
          usage = {
            input_tokens: usage.input_tokens,
            output_tokens: event.usage.output_tokens,
          };
        } else if (event.type === 'message_start') {
          usage = {
            input_tokens: event.message.usage.input_tokens,
            output_tokens: event.message.usage.output_tokens,
          };
        } else if (event.type === 'message_stop') {
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
              usage: {
                promptTokens: usage.input_tokens,
                completionTokens: usage.output_tokens,
                totalTokens: usage.input_tokens + usage.output_tokens,
              },
              model: this.model,
              finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
            },
          };
        }
      }
    } catch (error) {
      yield { type: 'error', error: error instanceof Error ? error.message : 'Stream error' };
    }
  }

  countTokens(text: string): Promise<number> {
    // Rough estimate: ~4 characters per token
    // Anthropic provides a count_tokens endpoint but it's not in the SDK yet
    return Promise.resolve(Math.ceil(text.length / 4));
  }

  listModels(): Promise<string[]> {
    // Anthropic doesn't have a models endpoint, return known models
    return Promise.resolve([
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
      'claude-3-opus-20240229',
      'claude-3-sonnet-20240229',
      'claude-3-haiku-20240307',
    ]);
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Make a minimal request to check API access
      await this.client.messages.create({
        model: this.model,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 1,
      });
      return true;
    } catch {
      return false;
    }
  }

  private formatMessages(
    inputMessages: ChatMessage[],
    systemPrompt?: string,
  ): { messages: Anthropic.MessageParam[]; systemPrompt?: string } {
    const messages: Anthropic.MessageParam[] = [];
    let effectiveSystemPrompt = systemPrompt;

    for (const msg of inputMessages) {
      if (msg.role === 'system') {
        // Anthropic uses a separate system parameter
        effectiveSystemPrompt = effectiveSystemPrompt
          ? `${effectiveSystemPrompt}\n\n${msg.content}`
          : msg.content;
        continue;
      }

      if (msg.role === 'tool') {
        // Tool results in Anthropic are content blocks in user messages
        const lastMsg = messages[messages.length - 1];
        if (lastMsg?.role === 'user' && Array.isArray(lastMsg.content)) {
          // Append to existing user message with array content
          lastMsg.content.push({
            type: 'tool_result',
            tool_use_id: msg.toolCallId ?? '',
            content: msg.content,
          });
        } else {
          // Create new user message with tool result
          messages.push({
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: msg.toolCallId ?? '',
                content: msg.content,
              },
            ],
          });
        }
        continue;
      }

      // Regular user or assistant message
      messages.push({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content,
      });
    }

    return { messages, systemPrompt: effectiveSystemPrompt };
  }

  private formatTools(tools: ToolDefinition[]): Anthropic.Tool[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters as Anthropic.Tool.InputSchema,
    }));
  }

  private mapStopReason(reason: string): ChatCompletionResponse['finishReason'] {
    switch (reason) {
      case 'end_turn':
      case 'stop_sequence':
        return 'stop';
      case 'max_tokens':
        return 'length';
      case 'tool_use':
        return 'tool_calls';
      default:
        return 'stop';
    }
  }
}
