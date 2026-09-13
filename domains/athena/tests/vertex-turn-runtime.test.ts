import { describe, expect, it, vi } from 'vitest';

import type { TurnEvent, TurnInput } from '../src/turn/turn';
import {
  DEFAULT_VERTEX_LOCATION,
  DEFAULT_VERTEX_MODEL,
  VertexAgentTurnRuntime,
  buildVertexTurnRequest,
  vertexEndpoint,
  type VertexGenerateContent,
} from '../src/turn/adapters/vertex';

const input: TurnInput = {
  system: 'Return one review decision.',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Review Instagram.' }] }],
  tools: [
    {
      name: 'review_result',
      description: 'Return the review decision.',
      inputSchema: {
        type: 'object',
        properties: { decision: { type: 'string', enum: ['grant', 'challenge', 'deny'] } },
        required: ['decision'],
      },
    },
  ],
};

async function collect(stream: AsyncIterable<TurnEvent>): Promise<TurnEvent[]> {
  const events: TurnEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe('Vertex turn adapter', () => {
  it('maps the Athena turn onto Vertex function declarations without credentials', () => {
    expect(buildVertexTurnRequest(input)).toEqual({
      systemInstruction: { parts: [{ text: 'Return one review decision.' }] },
      contents: [{ role: 'user', parts: [{ text: 'Review Instagram.' }] }],
      tools: [
        {
          functionDeclarations: [
            {
              name: 'review_result',
              description: 'Return the review decision.',
              parameters: input.tools[0]?.inputSchema,
            },
          ],
        },
      ],
      generationConfig: { maxOutputTokens: 1_024, temperature: 0 },
    });
  });

  it('emits one appendable Athena tool call from a Vertex response', async () => {
    const generate: VertexGenerateContent = vi.fn(async () => ({
      modelVersion: DEFAULT_VERTEX_MODEL,
      candidates: [
        {
          finishReason: 'STOP',
          content: {
            role: 'model',
            parts: [
              {
                functionCall: {
                  name: 'review_result',
                  args: {
                    decision: 'grant',
                    reason: 'The research produces task evidence.',
                    scope: { kind: 'origin', value: 'https://www.instagram.com' },
                  },
                },
              },
            ],
          },
        },
      ],
      usageMetadata: {
        promptTokenCount: 82,
        candidatesTokenCount: 24,
        cachedContentTokenCount: 10,
      },
    }));
    const runtime = new VertexAgentTurnRuntime(
      { projectId: 'athena-services', location: DEFAULT_VERTEX_LOCATION },
      generate,
    );

    expect(await collect(runtime.streamTurn(input))).toEqual([
      {
        type: 'tool_use',
        id: 'vertex_tool_0_0',
        name: 'review_result',
        input: {
          decision: 'grant',
          reason: 'The research produces task evidence.',
          scope: { kind: 'origin', value: 'https://www.instagram.com' },
        },
      },
      {
        type: 'turn_end',
        stopReason: 'tool_use',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'vertex_tool_0_0',
              name: 'review_result',
              input: {
                decision: 'grant',
                reason: 'The research produces task evidence.',
                scope: { kind: 'origin', value: 'https://www.instagram.com' },
              },
            },
          ],
        },
        usage: {
          inputTokens: 72,
          outputTokens: 24,
          cacheReadTokens: 10,
          cacheCreationTokens: 0,
          model: DEFAULT_VERTEX_MODEL,
        },
      },
    ]);
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'athena-services', location: 'global' }),
      expect.objectContaining({ contents: expect.any(Array) }),
    );
  });

  it('preserves tool results when a later turn is sent to Vertex', () => {
    const initialMessage = input.messages.at(0);
    if (!initialMessage) throw new Error('test fixture has no initial message');
    const request = buildVertexTurnRequest({
      ...input,
      messages: [
        initialMessage,
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'review_result',
              input: { decision: 'challenge' },
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              toolUseId: 'toolu_1',
              content: 'Challenge answered.',
              isError: false,
            },
          ],
        },
      ],
    });

    expect(request.contents.at(-1)).toEqual({
      role: 'user',
      parts: [
        {
          functionResponse: {
            name: 'review_result',
            response: { content: 'Challenge answered.', isError: false },
          },
        },
      ],
    });
  });

  it('drops provider-specific thinking and omits tools when none are available', () => {
    const request = buildVertexTurnRequest(
      {
        system: 'Continue the turn.',
        messages: [
          {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: 'Private reasoning.', signature: 'sig_1' },
              { type: 'text', text: 'Visible answer.' },
            ],
          },
          {
            role: 'user',
            content: [{ type: 'thinking', thinking: 'Discard this.', signature: 'sig_2' }],
          },
        ],
        tools: [],
      },
      64,
    );

    expect(request).toEqual({
      systemInstruction: { parts: [{ text: 'Continue the turn.' }] },
      contents: [{ role: 'model', parts: [{ text: 'Visible answer.' }] }],
      generationConfig: { maxOutputTokens: 64, temperature: 0 },
    });
  });

  it('rejects a tool result whose originating call is absent', () => {
    expect(() =>
      buildVertexTurnRequest({
        system: 'Continue the turn.',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                toolUseId: 'missing_call',
                content: 'No matching call.',
                isError: true,
              },
            ],
          },
        ],
        tools: [],
      }),
    ).toThrow('Vertex turn is missing tool use missing_call');
  });

  it('builds global and regional generate-content endpoints', () => {
    expect(
      vertexEndpoint({
        projectId: 'athena-services',
        location: 'global',
        model: 'gemini-2.5-flash',
        maxOutputTokens: 64,
      }),
    ).toBe(
      'https://aiplatform.googleapis.com/v1/projects/athena-services/locations/global/publishers/google/models/gemini-2.5-flash%3AgenerateContent',
    );
    expect(
      vertexEndpoint({
        projectId: 'athena-services',
        location: 'us-central1',
        model: 'gemini-2.5-flash',
        maxOutputTokens: 64,
      }),
    ).toBe(
      'https://us-central1-aiplatform.googleapis.com/v1/projects/athena-services/locations/us-central1/publishers/google/models/gemini-2.5-flash%3AgenerateContent',
    );
  });

  it('normalizes text and missing usage fields from a custom model', async () => {
    const generate: VertexGenerateContent = vi.fn(async () => ({
      candidates: [
        {
          content: {
            parts: [{ text: '  Finished.  ' }, { text: '   ' }, { functionCall: { name: '' } }],
          },
        },
      ],
      usageMetadata: {},
    }));
    const runtime = new VertexAgentTurnRuntime(
      {
        projectId: 'athena-services',
        location: 'us-central1',
        model: 'gemini-custom',
        maxOutputTokens: 64,
      },
      generate,
    );

    expect(await collect(runtime.streamTurn({ ...input, tools: [] }))).toEqual([
      { type: 'text', text: 'Finished.' },
      {
        type: 'turn_end',
        stopReason: 'end_turn',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Finished.' }] },
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          model: 'gemini-custom',
        },
      },
    ]);
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ maxOutputTokens: 64, model: 'gemini-custom' }),
      expect.objectContaining({ generationConfig: { maxOutputTokens: 64, temperature: 0 } }),
    );
  });

  it('uses an empty object when Vertex omits function arguments', async () => {
    const runtime = new VertexAgentTurnRuntime({ projectId: 'athena-services' }, async () => ({
      candidates: [
        {
          content: { parts: [{ functionCall: { name: 'review_result' } }] },
        },
      ],
    }));

    expect(await collect(runtime.streamTurn(input))).toEqual([
      {
        type: 'tool_use',
        id: 'vertex_tool_0_0',
        name: 'review_result',
        input: {},
      },
      {
        type: 'turn_end',
        stopReason: 'tool_use',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'vertex_tool_0_0',
              name: 'review_result',
              input: {},
            },
          ],
        },
      },
    ]);
  });

  it.each([
    ['MAX_TOKENS', 'max_tokens'],
    ['SAFETY', 'refusal'],
    ['BLOCKLIST', 'refusal'],
    ['PROHIBITED_CONTENT', 'refusal'],
    ['STOP', 'end_turn'],
  ] as const)('maps the %s finish reason to %s', async (finishReason, expected) => {
    const runtime = new VertexAgentTurnRuntime({ projectId: 'athena-services' }, async () => ({
      candidates: [{ finishReason, content: {} }],
    }));

    expect(await collect(runtime.streamTurn({ ...input, tools: [] }))).toEqual([
      {
        type: 'turn_end',
        stopReason: expected,
        message: { role: 'assistant', content: [] },
      },
    ]);
  });

  it.each([
    ['no candidates', {}],
    ['a candidate without content', { candidates: [{}] }],
  ])('rejects a response with %s', async (_label, response) => {
    const runtime = new VertexAgentTurnRuntime(
      { projectId: 'athena-services' },
      async () => response,
    );

    await expect(collect(runtime.streamTurn(input))).rejects.toThrow(
      'Vertex returned no Athena candidate',
    );
  });
});
