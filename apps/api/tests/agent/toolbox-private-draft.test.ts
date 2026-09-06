/**
 * `@docket/api` — the toolbox's reading of Docket's `docket/approval` metadata.
 *
 * @remarks
 * The private-draft marker rides in a tool's `_meta`, not in its annotations, so the toolbox has to
 * lift it into the classifier's hint shape itself. This swaps the in-process MCP client for a fake
 * one, exactly as `toolbox-tool-defs.test.ts` does, so the mapping is what is under test rather
 * than the real catalog.
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

const { buildServer } = vi.hoisted(() => ({ buildServer: vi.fn() }));
vi.mock('../../src/mcp/server', () => ({ buildServer }));

import type * as DbModule from '@docket/db';
import { assertDefined } from '@docket/test-utils';

import type { openToolbox as OpenToolbox } from '../../src/agent/toolbox';
import { getMigratedDb } from '../support/db';

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

describe('openToolbox — private-draft metadata', () => {
  it('lifts the marker into the hints and forwards the session id to the server', async () => {
    buildServer.mockReset();
    buildServer.mockReturnValue({ connect: async () => undefined });
    listTools.mockReset();
    listTools.mockResolvedValueOnce({
      tools: [
        {
          name: 'plan_draft',
          description: 'Draft on the canvas',
          inputSchema: { type: 'object' },
          annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
          _meta: { 'docket/approval': 'private_draft' },
        },
        {
          name: 'marker_only',
          inputSchema: { type: 'object' },
          _meta: { 'docket/approval': 'private_draft' },
        },
        {
          name: 'plan_commit',
          inputSchema: { type: 'object' },
          annotations: { readOnlyHint: false },
          _meta: { 'docket/approval': 'something_else' },
        },
      ],
    });
    const userId = await seedUser();
    const toolbox = await openToolbox({ kind: 'athena', ownerUserId: userId }, 'sess_123');
    try {
      expect(buildServer).toHaveBeenCalledWith(expect.anything(), 'sess_123');
      expect(toolbox.annotations('plan_draft')).toEqual({
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
        privateDraft: true,
      });
      expect(toolbox.annotations('marker_only')).toEqual({ privateDraft: true });
      expect(toolbox.annotations('plan_commit')).toEqual({ readOnlyHint: false });
      expect(toolbox.annotationSource('plan_draft')).toBe('first_party');
    } finally {
      await toolbox.close();
    }
  });

  it('opens the server without a session when none is given', async () => {
    buildServer.mockReset();
    buildServer.mockReturnValue({ connect: async () => undefined });
    listTools.mockReset();
    listTools.mockResolvedValueOnce({ tools: [] });
    const userId = await seedUser();
    const toolbox = await openToolbox({ kind: 'athena', ownerUserId: userId });
    try {
      expect(buildServer).toHaveBeenCalledWith(expect.anything(), null);
    } finally {
      await toolbox.close();
    }
  });
});
