/** Behavioral coverage for MCP catalog JSON Schema metadata shapes. */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

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

  it('marks an all-optional prompt argument as optional when JSON Schema omits required', () => {
    expect(
      promptListValue('search', { argsSchema: { query: z.string().optional() } }).arguments,
    ).toEqual([{ name: 'query', description: undefined, required: false }]);
  });
});
