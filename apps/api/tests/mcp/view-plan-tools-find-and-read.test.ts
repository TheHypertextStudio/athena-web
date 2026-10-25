/** `find` projection and the semantic `get_*` read fallbacks, against a controlled engine. */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type * as DbModule from '@docket/db';

import type { z } from 'zod';

import type { SearchRoute } from '../../src/contracts/search';
import { SearchResult } from '../../src/contracts/search';
import type { McpContext } from '../../src/mcp/auth';
import type * as Resources from '../../src/mcp/resources';
import type * as SearchQuery from '../../src/search/query';
import type * as ViewPlanTools from '../../src/mcp/view-plan-tools';
import { getMigratedDb } from '../support/db';
import { body, closeCatalogClients, connectCatalog } from './mcp-catalog-harness';
import { seedMcpUpdateOrg } from './mcp-update-tool-fixtures';

const engine = vi.hoisted(() => ({
  searchWorkspace: vi.fn(),
  readEntity: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

vi.mock('../../src/search/query', async (importOriginal) => ({
  ...(await importOriginal<typeof SearchQuery>()),
  searchWorkspace: engine.searchWorkspace,
}));
vi.mock('../../src/mcp/resources', async (importOriginal) => ({
  ...(await importOriginal<typeof Resources>()),
  readEntity: engine.readEntity,
}));

let schema!: typeof DbModule;
let registerViewPlanTools!: typeof ViewPlanTools.registerViewPlanTools;

beforeAll(async () => {
  schema = await getMigratedDb();
  registerViewPlanTools = (await import('../../src/mcp/view-plan-tools')).registerViewPlanTools;
});

afterEach(async () => {
  await closeCatalogClients();
  vi.clearAllMocks();
});

/** One `find` result row as the tool reports it. */
interface FindItem {
  kind: string;
  id: string;
  title: string;
  summary?: string;
  subjectKind?: string;
  subjectId?: string;
}

/** The `find` tool's structured output. */
interface FindBody {
  items: FindItem[];
  facets: { field: string }[];
  nextCursor?: string;
}

/** The semantic read tools' structured output. */
interface ReadBody {
  items: { id: string; href: string }[];
  missing: { ref: string; reason: string }[];
}

/** Build a validated search engine row whose only meaningful fields are its route and text. */
function hit(
  orgId: string,
  route: z.input<typeof SearchRoute>,
  extra: Partial<Pick<z.input<typeof SearchResult>, 'summary' | 'subject'>> = {},
): SearchResult {
  return SearchResult.parse({
    id: `task:${orgId}:${route.type}`,
    organizationId: orgId,
    userId: null,
    kind: 'task',
    family: 'work',
    title: `Result ${route.type}`,
    summary: null,
    snippet: null,
    matchedFields: ['title'],
    route,
    subject: null,
    source: null,
    facets: {},
    actions: [],
    score: 1,
    entityId: 'entity',
    externalUrl: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  });
}

async function connect(ctx: McpContext) {
  return connectCatalog((server, context) => {
    registerViewPlanTools(server, context);
  }, ctx);
}

describe('find', () => {
  it('returns the actionable id for every route kind and drops hits that live outside Docket', async () => {
    const seed = await seedMcpUpdateOrg(schema.db, schema, ['view']);
    engine.searchWorkspace.mockResolvedValue({
      items: [
        hit(seed.orgId, {
          type: 'entity',
          organizationId: seed.orgId,
          entityKind: 'task',
          entityId: 'task-1',
          href: '/t',
        }),
        hit(
          seed.orgId,
          {
            type: 'content',
            organizationId: seed.orgId,
            subjectKind: 'task',
            subjectId: 'task-1',
            contentKind: 'comment',
            contentId: 'comment-1',
            href: '/c',
          },
          {
            summary: 'Discussed the rollout',
            subject: { kind: 'task', id: 'task-1', title: 'Rollout', organizationId: seed.orgId },
          },
        ),
        hit(seed.orgId, {
          type: 'activity',
          organizationId: seed.orgId,
          eventId: 'event-1',
          href: null,
          externalUrl: null,
        }),
        hit(seed.orgId, { type: 'calendar_event', calendarEventId: 'meeting-1', href: '/m' }),
        hit(seed.orgId, { type: 'external', externalUrl: 'https://example.com' }),
      ],
      facets: [{ field: 'kind', label: 'Kind', values: [] }],
      nextCursor: 'next-page',
    });
    const client = await connect(seed.ctx);

    const result = body<FindBody>(
      await client.callTool({ name: 'find', arguments: { orgId: seed.orgId, query: 'rollout' } }),
    );

    expect(result.items.map((item) => item.id)).toEqual([
      'task-1',
      'comment-1',
      'event-1',
      'meeting-1',
    ]);
    expect(result.items[1]).toMatchObject({ subjectKind: 'task', subjectId: 'task-1' });
    expect(result.items[1]?.summary).toBeDefined();
    expect(result.items[0]).not.toHaveProperty('summary');
    expect(result.items[0]).not.toHaveProperty('subjectId');
    expect(result.nextCursor).toBe('next-page');
  });

  it('forwards every supplied filter and the cursor to the engine', async () => {
    const seed = await seedMcpUpdateOrg(schema.db, schema, ['view']);
    engine.searchWorkspace.mockResolvedValue({ items: [], facets: [] });
    const client = await connect(seed.ctx);
    const filters = {
      cursor: 'page-2',
      kinds: ['task'],
      assigneeIds: [seed.actorId],
      ownerIds: [seed.sarahId],
      labelIds: ['label-1'],
      statuses: ['todo'],
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-02-01T00:00:00.000Z',
    };

    const result = body<FindBody>(
      await client.callTool({
        name: 'find',
        arguments: { orgId: seed.orgId, query: 'plan', ...filters },
      }),
    );

    expect(result).not.toHaveProperty('nextCursor');
    expect(engine.searchWorkspace).toHaveBeenCalledTimes(1);
    expect(engine.searchWorkspace.mock.calls[0]?.[0]).toMatchObject({
      orgId: seed.orgId,
      caller: { kind: 'user' },
      params: { q: 'plan', ...filters },
    });
  });

  it('refuses a caller without view on the workspace before searching', async () => {
    const seed = await seedMcpUpdateOrg(schema.db, schema, []);
    const client = await connect(seed.ctx);

    const result = await client.callTool({
      name: 'find',
      arguments: { orgId: seed.orgId, query: 'plan' },
    });

    expect(result.isError).toBe(true);
    expect(engine.searchWorkspace).not.toHaveBeenCalled();
  });
});

describe('semantic reads', () => {
  it('reports malformed hydrated rows and unexpected failures as internal misses', async () => {
    const seed = await seedMcpUpdateOrg(schema.db, schema, ['view']);
    engine.readEntity.mockImplementation(async (_ctx, _org, _type, id) => {
      if (id === 'array') return [];
      if (id === 'nameless') return { id: 7 };
      if (id === 'boom') throw new Error('driver failure');
      return { id, title: 'Readable' };
    });
    const client = await connect(seed.ctx);

    const result = body<ReadBody>(
      await client.callTool({
        name: 'get_tasks',
        arguments: { orgId: seed.orgId, refs: ['array', 'nameless', 'boom', 'task-ok'] },
      }),
    );

    expect(result.items.map((item) => item.id)).toEqual(['task-ok']);
    expect(result.items[0]?.href).toContain('task-ok');
    expect(result.missing).toEqual([
      { ref: 'array', reason: 'internal' },
      { ref: 'nameless', reason: 'internal' },
      { ref: 'boom', reason: 'internal' },
    ]);
  });
});
