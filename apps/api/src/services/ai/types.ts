/**
 * AI service types and interfaces.
 *
 * @packageDocumentation
 */

/**
 * Supported LLM providers.
 */
export type AIProvider = 'openai' | 'anthropic' | 'google';

/**
 * Message role in a conversation.
 */
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

/**
 * A single message in a conversation.
 */
export interface ChatMessage {
  role: MessageRole;
  content: string;
  /** Tool call ID if this is a tool response */
  toolCallId?: string;
  /** Tool name if this is a tool response */
  toolName?: string;
}

/**
 * Tool definition for function calling.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<
      string,
      {
        type: string;
        description?: string;
        enum?: string[];
        items?: { type: string };
      }
    >;
    required?: string[];
  };
}

/**
 * A tool call requested by the AI.
 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Result of a tool execution.
 */
export interface ToolResult {
  toolCallId: string;
  result: unknown;
  error?: string;
}

/**
 * Options for a chat completion request.
 */
export interface ChatCompletionOptions {
  /** The conversation messages */
  messages: ChatMessage[];
  /** Optional system prompt override */
  systemPrompt?: string;
  /** Available tools for the AI to use */
  tools?: ToolDefinition[];
  /** Temperature (0-2, default 0.7) */
  temperature?: number;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Stop sequences */
  stopSequences?: string[];
  /** User ID for logging/attribution */
  userId?: string;
}

/**
 * A chunk of a streaming response.
 */
export interface StreamChunk {
  type: 'content' | 'tool_call' | 'done' | 'error';
  /** Text content for content chunks */
  content?: string;
  /** Tool call for tool_call chunks */
  toolCall?: ToolCall;
  /** Error message for error chunks */
  error?: string;
  /** Full response when done */
  fullResponse?: ChatCompletionResponse;
}

/**
 * Response from a chat completion request.
 */
export interface ChatCompletionResponse {
  /** Generated text content */
  content: string;
  /** Tool calls requested by the AI */
  toolCalls: ToolCall[];
  /** Token usage statistics */
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** The model that generated the response */
  model: string;
  /** Finish reason */
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter';
}

/**
 * Configuration for an AI provider.
 */
export interface AIProviderConfig {
  /** API key for the provider */
  apiKey: string;
  /** Base URL override (for proxies/custom endpoints) */
  baseUrl?: string;
  /** Default model to use */
  defaultModel?: string;
  /** Organization ID (for OpenAI) */
  organizationId?: string;
  /** Request timeout in milliseconds */
  timeoutMs?: number;
}

/**
 * Interface that all AI providers must implement.
 */
export interface AIProviderInterface {
  /** Provider identifier */
  readonly provider: AIProvider;

  /** Default model for this provider */
  readonly defaultModel: string;

  /**
   * Generate a chat completion.
   */
  chat(options: ChatCompletionOptions): Promise<ChatCompletionResponse>;

  /**
   * Generate a streaming chat completion.
   */
  chatStream(options: ChatCompletionOptions): AsyncGenerator<StreamChunk>;

  /**
   * Count tokens in a message.
   * Returns an estimate if exact counting is not available.
   */
  countTokens(text: string): Promise<number>;

  /**
   * List available models for this provider.
   */
  listModels(): Promise<string[]>;

  /**
   * Check if the provider is properly configured and accessible.
   */
  healthCheck(): Promise<boolean>;
}

/**
 * Provider-specific model information.
 */
export interface ModelInfo {
  id: string;
  name: string;
  provider: AIProvider;
  contextWindow: number;
  maxOutputTokens: number;
  supportsTools: boolean;
  supportsStreaming: boolean;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
}

/**
 * Known models and their capabilities.
 */
export const KNOWN_MODELS: Record<string, ModelInfo> = {
  // OpenAI Models
  'gpt-4o': {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    contextWindow: 128000,
    maxOutputTokens: 16384,
    supportsTools: true,
    supportsStreaming: true,
    inputPricePerMillion: 2.5,
    outputPricePerMillion: 10,
  },
  'gpt-4o-mini': {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'openai',
    contextWindow: 128000,
    maxOutputTokens: 16384,
    supportsTools: true,
    supportsStreaming: true,
    inputPricePerMillion: 0.15,
    outputPricePerMillion: 0.6,
  },
  'gpt-4-turbo': {
    id: 'gpt-4-turbo',
    name: 'GPT-4 Turbo',
    provider: 'openai',
    contextWindow: 128000,
    maxOutputTokens: 4096,
    supportsTools: true,
    supportsStreaming: true,
    inputPricePerMillion: 10,
    outputPricePerMillion: 30,
  },

  // Anthropic Models
  'claude-3-5-sonnet-20241022': {
    id: 'claude-3-5-sonnet-20241022',
    name: 'Claude 3.5 Sonnet',
    provider: 'anthropic',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    supportsTools: true,
    supportsStreaming: true,
    inputPricePerMillion: 3,
    outputPricePerMillion: 15,
  },
  'claude-3-5-haiku-20241022': {
    id: 'claude-3-5-haiku-20241022',
    name: 'Claude 3.5 Haiku',
    provider: 'anthropic',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    supportsTools: true,
    supportsStreaming: true,
    inputPricePerMillion: 0.8,
    outputPricePerMillion: 4,
  },
  'claude-3-opus-20240229': {
    id: 'claude-3-opus-20240229',
    name: 'Claude 3 Opus',
    provider: 'anthropic',
    contextWindow: 200000,
    maxOutputTokens: 4096,
    supportsTools: true,
    supportsStreaming: true,
    inputPricePerMillion: 15,
    outputPricePerMillion: 75,
  },

  // Google Models
  'gemini-1.5-pro': {
    id: 'gemini-1.5-pro',
    name: 'Gemini 1.5 Pro',
    provider: 'google',
    contextWindow: 2000000,
    maxOutputTokens: 8192,
    supportsTools: true,
    supportsStreaming: true,
    inputPricePerMillion: 1.25,
    outputPricePerMillion: 5,
  },
  'gemini-1.5-flash': {
    id: 'gemini-1.5-flash',
    name: 'Gemini 1.5 Flash',
    provider: 'google',
    contextWindow: 1000000,
    maxOutputTokens: 8192,
    supportsTools: true,
    supportsStreaming: true,
    inputPricePerMillion: 0.075,
    outputPricePerMillion: 0.3,
  },
};

/**
 * Default models per provider.
 */
export const DEFAULT_MODELS: Record<AIProvider, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-sonnet-20241022',
  google: 'gemini-1.5-flash',
};
