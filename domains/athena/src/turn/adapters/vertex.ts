/** Vertex AI adapter for Athena's provider-neutral one-turn boundary. */
import { GoogleAuth } from 'google-auth-library';

import type { TurnContentBlock } from '../../turn-protocol';
import type { AgentTurnRuntime, TurnEvent, TurnInput, TurnStopReason, TurnUsage } from '../turn';

/** Production model used when Docket runs Athena through Vertex AI. */
export const DEFAULT_VERTEX_MODEL = 'gemini-2.5-flash';

/** Vertex's global endpoint keeps Docket independent of one regional quota pool. */
export const DEFAULT_VERTEX_LOCATION = 'global';

/** The review does not need the 16k-token ceiling used by long Athena sessions. */
export const DEFAULT_VERTEX_MAX_OUTPUT_TOKENS = 1_024;

/** Configuration needed to reach Vertex through Application Default Credentials. */
export interface VertexAgentTurnRuntimeConfig {
  readonly projectId: string;
  readonly location?: string;
  readonly model?: string;
  readonly maxOutputTokens?: number;
}

interface VertexTextPart {
  readonly text: string;
}

interface VertexFunctionCallPart {
  readonly functionCall: { readonly name: string; readonly args?: unknown };
}

interface VertexFunctionResponsePart {
  readonly functionResponse: {
    readonly name: string;
    readonly response: { readonly content: string; readonly isError: boolean };
  };
}

type VertexPart = VertexTextPart | VertexFunctionCallPart | VertexFunctionResponsePart;

interface VertexContent {
  readonly role: 'user' | 'model';
  readonly parts: readonly VertexPart[];
}

/** Request shape sent to Vertex's generateContent method. */
export interface VertexTurnRequest {
  readonly systemInstruction: { readonly parts: readonly VertexTextPart[] };
  readonly contents: readonly VertexContent[];
  readonly tools?: readonly [
    {
      readonly functionDeclarations: readonly {
        readonly name: string;
        readonly description: string;
        readonly parameters: Record<string, unknown>;
      }[];
    },
  ];
  readonly generationConfig: {
    readonly maxOutputTokens: number;
    readonly temperature: number;
  };
}

/** Minimal response surface Athena consumes from Vertex. */
export interface VertexTurnResponse {
  readonly modelVersion?: string;
  readonly candidates?: readonly {
    readonly finishReason?: string;
    readonly content?: {
      readonly role?: string;
      readonly parts?: readonly (VertexTextPart | VertexFunctionCallPart)[];
    };
  }[];
  readonly usageMetadata?: {
    readonly promptTokenCount?: number;
    readonly candidatesTokenCount?: number;
    readonly cachedContentTokenCount?: number;
  };
}

/** Injectable authenticated Vertex request edge. */
export type VertexGenerateContent = (
  config: Required<VertexAgentTurnRuntimeConfig>,
  request: VertexTurnRequest,
) => Promise<VertexTurnResponse>;

function toolNamesByUseId(input: TurnInput): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  for (const message of input.messages) {
    for (const block of message.content) {
      if (block.type === 'tool_use') names.set(block.id, block.name);
    }
  }
  return names;
}

function toVertexPart(
  block: TurnContentBlock,
  toolNames: ReadonlyMap<string, string>,
): VertexPart | null {
  switch (block.type) {
    case 'text':
      return { text: block.text };
    case 'thinking':
      // Provider reasoning signatures cannot be replayed across model families.
      return null;
    case 'tool_use':
      return { functionCall: { name: block.name, args: block.input } };
    case 'tool_result': {
      const name = toolNames.get(block.toolUseId);
      if (!name) throw new Error(`Vertex turn is missing tool use ${block.toolUseId}`);
      return {
        functionResponse: {
          name,
          response: { content: block.content, isError: block.isError },
        },
      };
    }
  }
}

/** Build a Vertex request without performing network I/O. */
export function buildVertexTurnRequest(
  input: TurnInput,
  maxOutputTokens = DEFAULT_VERTEX_MAX_OUTPUT_TOKENS,
): VertexTurnRequest {
  const toolNames = toolNamesByUseId(input);
  const contents = input.messages.flatMap((message) => {
    const parts = message.content.flatMap((block) => {
      const part = toVertexPart(block, toolNames);
      return part ? [part] : [];
    });
    return parts.length > 0
      ? [{ role: message.role === 'assistant' ? ('model' as const) : ('user' as const), parts }]
      : [];
  });

  return {
    systemInstruction: { parts: [{ text: input.system }] },
    contents,
    ...(input.tools.length > 0
      ? {
          tools: [
            {
              functionDeclarations: input.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema,
              })),
            },
          ] as const,
        }
      : {}),
    generationConfig: { maxOutputTokens, temperature: 0 },
  };
}

/** Resolve Vertex's global or regional REST endpoint for one model. */
export function vertexEndpoint(config: Required<VertexAgentTurnRuntimeConfig>): string {
  const host =
    config.location === 'global'
      ? 'aiplatform.googleapis.com'
      : `${config.location}-aiplatform.googleapis.com`;
  const path = [
    'v1',
    'projects',
    config.projectId,
    'locations',
    config.location,
    'publishers',
    'google',
    'models',
    config.model,
  ]
    .map(encodeURIComponent)
    .join('/');
  return `https://${host}/${path}:generateContent`;
}

/** Send one request with the Cloud Run service account or local ADC identity. */
export function defaultVertexGenerateContent(): VertexGenerateContent {
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  return async (config, request) => {
    const client = await auth.getClient();
    const response = await client.request<VertexTurnResponse>({
      url: vertexEndpoint(config),
      method: 'POST',
      data: request,
    });
    return response.data;
  };
}

function stopReason(
  parts: readonly TurnContentBlock[],
  finishReason: string | undefined,
): TurnStopReason {
  if (parts.some((part) => part.type === 'tool_use')) return 'tool_use';
  if (finishReason === 'MAX_TOKENS') return 'max_tokens';
  if (
    finishReason === 'SAFETY' ||
    finishReason === 'BLOCKLIST' ||
    finishReason === 'PROHIBITED_CONTENT'
  ) {
    return 'refusal';
  }
  return 'end_turn';
}

function usageOf(
  response: VertexTurnResponse,
  config: Required<VertexAgentTurnRuntimeConfig>,
): TurnUsage | undefined {
  const usage = response.usageMetadata;
  if (!usage) return undefined;
  const cached = usage.cachedContentTokenCount ?? 0;
  return {
    inputTokens: Math.max(0, (usage.promptTokenCount ?? 0) - cached),
    outputTokens: usage.candidatesTokenCount ?? 0,
    cacheReadTokens: cached,
    cacheCreationTokens: 0,
    model: response.modelVersion ?? config.model,
  };
}

/** Athena turn runtime backed by Vertex AI and Application Default Credentials. */
export class VertexAgentTurnRuntime implements AgentTurnRuntime {
  private readonly config: Required<VertexAgentTurnRuntimeConfig>;
  private readonly generate: VertexGenerateContent;

  constructor(
    config: VertexAgentTurnRuntimeConfig,
    generate: VertexGenerateContent = defaultVertexGenerateContent(),
  ) {
    this.config = {
      projectId: config.projectId,
      location: config.location ?? DEFAULT_VERTEX_LOCATION,
      model: config.model ?? DEFAULT_VERTEX_MODEL,
      maxOutputTokens: config.maxOutputTokens ?? DEFAULT_VERTEX_MAX_OUTPUT_TOKENS,
    };
    this.generate = generate;
  }

  async *streamTurn(input: TurnInput): AsyncIterable<TurnEvent> {
    const response = await this.generate(
      this.config,
      buildVertexTurnRequest(input, this.config.maxOutputTokens),
    );
    const candidate = response.candidates?.[0];
    if (!candidate?.content) throw new Error('Vertex returned no Athena candidate');

    const content: TurnContentBlock[] = [];
    for (const [index, part] of (candidate.content.parts ?? []).entries()) {
      if ('text' in part && part.text.trim()) {
        const block = { type: 'text' as const, text: part.text.trim() };
        content.push(block);
        yield block;
      } else if ('functionCall' in part && part.functionCall.name) {
        const block = {
          type: 'tool_use' as const,
          id: `vertex_tool_0_${String(index)}`,
          name: part.functionCall.name,
          input: part.functionCall.args ?? {},
        };
        content.push(block);
        yield block;
      }
    }

    const usage = usageOf(response, this.config);
    yield {
      type: 'turn_end',
      stopReason: stopReason(content, candidate.finishReason),
      message: { role: 'assistant', content },
      ...(usage ? { usage } : {}),
    };
  }
}
