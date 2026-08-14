/**
 * `@docket/api` — the toolbox's local (Docket) tool-definition mapping: annotation-hint defaults
 * and the description fallback.
 *
 * @remarks
 * The real Docket MCP server always declares all three annotation hints and a description on
 * every registered tool, so nothing in this codebase naturally exercises the "unset" side of
 * `openToolbox`'s per-hint ternaries. This file swaps the in-process MCP client for a fake one
 * that returns crafted tool listings, so the mapping logic in `openToolbox` — not the real tool
 * registry — is what's under test.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

const { listTools } = vi.hoisted(() => ({ listTools: vi.fn() }));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class FakeClient {
    async connect(): Promise<undefined> {
      return undefined;
    }
    async listTools(): Promise<unknown> {
      return listTools();
    }
    async callTool(): Promise<unknown> {
      return { content: [], isError: false };
    }
    async close(): Promise<undefined> {
      return undefined;
    }
  },
}));
vi.mock('@modelcontextprotocol/sdk/inMemory.js', () => ({
  InMemoryTransport: { createLinkedPair: () => [{}, {}] },
}));
vi.mock('../../src/mcp/server', () => ({
  buildServer: () => ({ connect: async () => undefined }),
}));

import type * as DbModule from '@docket/db';

import type { openToolbox as OpenToolbox } from '../../src/agent/toolbox';
import { getMigratedDb } from '../support/db';
import { assertDefined } from '@docket/test-utils';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let openToolbox!: typeof OpenToolbox;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
  ({ openToolbox } = await import('../../src/agent/toolbox'));
});

async function seedUser(): Promise<string> {
  const [row] = await db
    .insert(schema.user)
    .values({ name: 'Fixture', email: `fixture-${Math.random().toString(36).slice(2)}@x.test` })
    .returning({ id: schema.user.id });
  return assertDefined(row).id;
}

describe('openToolbox — local tool-definition mapping', () => {
  it('falls back to the tool name and omits every unset annotation hint', async () => {
    listTools.mockReset();
    listTools.mockResolvedValueOnce({
      tools: [
        // No `description` and no `annotations` at all.
        { name: 'bare_tool', inputSchema: { type: 'object' } },
        // `annotations` present, but every individual hint unset.
        {
          name: 'partial_tool',
          description: 'Has its own description',
          inputSchema: { type: 'object' },
          annotations: {},
        },
        // Every hint explicitly set, for contrast.
        {
          name: 'full_tool',
          description: 'Fully annotated',
          inputSchema: { type: 'object' },
          annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
        },
      ],
    });
    const userId = await seedUser();

    const toolbox = await openToolbox({ kind: 'athena', ownerUserId: userId });
    try {
      const bare = toolbox.tools.find((tool) => tool.name === 'bare_tool');
      expect(bare?.description).toBe('bare_tool');
      expect(toolbox.annotations('bare_tool')).toBeUndefined();

      const partial = toolbox.tools.find((tool) => tool.name === 'partial_tool');
      expect(partial?.description).toBe('Has its own description');
      expect(toolbox.annotations('partial_tool')).toEqual({});

      const full = toolbox.tools.find((tool) => tool.name === 'full_tool');
      expect(full?.description).toBe('Fully annotated');
      expect(toolbox.annotations('full_tool')).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      });
    } finally {
      await toolbox.close();
    }
  });
});
