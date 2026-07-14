import { describe, expect, it } from 'vitest';

import { McpIntegrationUpdate } from '../src/integration';

describe('McpIntegrationUpdate', () => {
  it('accepts editable connector identity fields', () => {
    expect(McpIntegrationUpdate.parse({ label: 'Planning', alias: 'planning' })).toEqual({
      label: 'Planning',
      alias: 'planning',
    });
  });

  it('rejects empty names and invalid tool prefixes', () => {
    expect(McpIntegrationUpdate.safeParse({ label: '' }).success).toBe(false);
    expect(McpIntegrationUpdate.safeParse({ alias: 'Not Safe' }).success).toBe(false);
  });
});
