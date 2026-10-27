/** Behavioral coverage for MCP catalog JSON Schema metadata shapes. */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import Ajv2020 from 'ajv/dist/2020.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { UploadMcpOut } from '../../src/mcp/uploads';

import { promptListValue, toolListValue } from '../../src/mcp/list-metadata';

describe('MCP list metadata', () => {
  it('serializes absent, raw-shape, and Zod input schemas truthfully', () => {
    expect(toolListValue('absent', {}).inputSchema).toEqual({
      type: 'object',
      properties: {},
    });
    expect(toolListValue('raw', { inputSchema: { value: z.string() } }).inputSchema).toMatchObject({
      type: 'object',
      properties: { value: { type: 'string' } },
    });
    expect(
      toolListValue('zod', { inputSchema: z.object({ value: z.string() }) }).inputSchema,
    ).toMatchObject({
      type: 'object',
      properties: { value: { type: 'string' } },
    });
  });

  it('advertises object output unions without moving their local definitions or weakening validation', () => {
    const output = z
      .union([
        z.strictObject({ id: z.string().min(1) }),
        z.strictObject({ removed: z.literal(true) }),
      ])
      .meta({
        $defs: { id: { type: 'string', minLength: 1 } },
        anyOf: [
          {
            type: 'object',
            properties: { id: { $ref: '#/$defs/id' } },
            required: ['id'],
            additionalProperties: false,
          },
          {
            type: 'object',
            properties: { removed: { const: true } },
            required: ['removed'],
            additionalProperties: false,
          },
        ],
      });
    const original = z.toJSONSchema(output);
    const serialized = toolListValue('manage', { outputSchema: output }).outputSchema;
    expect(serialized).toEqual({ type: 'object', ...original });
    const ajv = new Ajv2020({ strict: false });
    const before = ajv.compile(original);
    const after = ajv.compile(serialized ?? {});
    const samples = [{ id: 'session' }, { removed: true }, { id: '' }, { removed: false }, {}, 1];
    expect(samples.map((sample) => after(sample))).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
    expect(samples.map((sample) => after(sample))).toEqual(samples.map((sample) => before(sample)));
  });

  it('validates upload session and cancellation outputs through the real MCP SDK', async () => {
    const session = {
      id: 'upload',
      state: 'pending',
      offset: 0,
      byteSize: 9,
      chunkSize: 9,
      expiresAt: '2026-10-28T00:00:00.000Z',
      uploadUrl: 'https://example.test/upload',
    };
    let response: Record<string, unknown> = session;
    const server = new McpServer({ name: 'upload-output', version: '1' });
    server.registerTool('upload_result', { outputSchema: UploadMcpOut }, () => ({
      content: [{ type: 'text', text: JSON.stringify(response) }],
      structuredContent: response,
    }));
    const client = new Client({ name: 'upload-output', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([server.connect(b), client.connect(a)]);
      const metadata = (await client.listTools()).tools[0]?.outputSchema;
      expect(metadata?.type).toBe('object');
      expect(metadata?.['anyOf']).toHaveLength(2);
      for (const valid of [session, { removed: true }]) {
        response = valid;
        const result = await client.callTool({ name: 'upload_result', arguments: {} });
        expect(result.isError, JSON.stringify(result)).not.toBe(true);
        expect(result.structuredContent).toEqual(valid);
      }
      for (const invalid of [
        {},
        { removed: false },
        { removed: true, extra: 1 },
        { ...session, offset: -1 },
        { ...session, extra: 1 },
      ]) {
        response = invalid;
        const result = await client.callTool({ name: 'upload_result', arguments: {} });
        expect(result.isError).toBe(true);
        expect(JSON.stringify(result.content)).toContain('Output validation error');
        expect(JSON.stringify(result.content)).not.toContain('_zod');
      }
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('marks an all-optional prompt argument as optional when JSON Schema omits required', () => {
    expect(
      promptListValue('search', { argsSchema: { query: z.string().optional() } }).arguments,
    ).toEqual([{ name: 'query', description: undefined, required: false }]);
  });
});
