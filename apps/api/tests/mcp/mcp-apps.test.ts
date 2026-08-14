/**
 * The MCP Apps surface (`io.modelcontextprotocol/ui`, SEP-1865).
 *
 * @remarks
 * These assert the parts a host actually depends on: the reserved scheme, the profile mimeType,
 * the `_meta.ui.resourceUri` linkage, and the fact that a document can boot with no network. They
 * deliberately do not assert markup — the widget's appearance is not a contract, but the protocol
 * around it is.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type { McpContext } from '../../src/mcp/auth';
import type { registerResources as RegisterResources } from '../../src/mcp/resources';
import type { registerTools as RegisterTools } from '../../src/mcp/tools';
import { resetAuthMocks } from '../support/auth-mock';
import { getMigratedDb } from '../support/db';
import { assertDefined } from '@docket/test-utils';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let registerTools!: typeof RegisterTools;
let registerResources!: typeof RegisterResources;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
  registerTools = (await import('../../src/mcp/tools')).registerTools;
  registerResources = (await import('../../src/mcp/resources')).registerResources;
});

const UI_EXTENSION = 'io.modelcontextprotocol/ui';
const UI_MIME_TYPE = 'text/html;profile=mcp-app';

/** Seed a member so the catalog registers under a real principal. */
async function seedCtx(): Promise<McpContext> {
  const slug = `ui-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  const email = `${slug}@e.com`;
  const [user] = await db
    .insert(schema.user)
    .values({ name: 'Ada', email })
    .returning({ id: schema.user.id });
  await db.insert(schema.actor).values({
    organizationId: assertDefined(org).id,
    kind: 'human',
    displayName: 'Ada',
    userId: assertDefined(user).id,
  });
  return {
    principal: { kind: 'user', userId: assertDefined(user).id, userName: 'Ada', userEmail: email },
    scopes: ['work:read', 'work:write', 'agents:run', 'connectors:link'],
  };
}

const harnesses: { close(): Promise<void> }[] = [];

async function connect(ctx: McpContext): Promise<Client> {
  const server = new McpServer(
    { name: 'test', version: '0.0.0' },
    { capabilities: { tools: {}, resources: {} } },
  );
  registerTools(server, ctx, 'sess_ui');
  registerResources(server, ctx);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'c', version: '0.0.0' });
  await Promise.all([server.connect(st), client.connect(ct)]);
  harnesses.push({
    close: async () => {
      await client.close();
      await server.close();
    },
  });
  return client;
}

afterEach(async () => {
  while (harnesses.length > 0) await assertDefined(harnesses.pop()).close();
  resetAuthMocks();
});

/** Every registered resource, paged to the end. */
async function allResources(client: Client): Promise<{ uri: string; mimeType?: string }[]> {
  const out: { uri: string; mimeType?: string }[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listResources(cursor ? { cursor } : undefined);
    out.push(...page.resources);
    cursor = page.nextCursor;
  } while (cursor);
  return out;
}

/** Every registered tool, paged to the end. */
async function allTools(client: Client): Promise<{ name: string; _meta?: unknown }[]> {
  const out: { name: string; _meta?: unknown }[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined);
    out.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);
  return out;
}

describe('ui:// widget resources', () => {
  it('advertises each widget under the reserved scheme with the profile mimeType', async () => {
    const client = await connect(await seedCtx());
    const widgets = (await allResources(client)).filter((r) => r.uri.startsWith('ui://'));

    expect(widgets.map((r) => r.uri).sort()).toEqual([
      'ui://docket/agents',
      'ui://docket/change-report',
      'ui://docket/comments',
      'ui://docket/cycles',
      'ui://docket/entity',
      'ui://docket/initiatives',
      'ui://docket/organizations',
      'ui://docket/plan',
      'ui://docket/programs',
      'ui://docket/projects',
      'ui://docket/sessions',
      'ui://docket/tasks',
      'ui://docket/teams',
      'ui://docket/updates',
      'ui://docket/views',
      'ui://docket/work-list',
    ]);
    // The mimeType is how a host tells an app document from an ordinary HTML resource.
    for (const widget of widgets) expect(widget.mimeType).toBe(UI_MIME_TYPE);
  });

  it('serves a document that can boot with no network at all', async () => {
    const client = await connect(await seedCtx());
    const read = await client.readResource({ uri: 'ui://docket/change-report' });
    const content = read.contents[0] as { mimeType: string; text: string };

    expect(content.mimeType).toBe(UI_MIME_TYPE);
    // The host serves these under a deny-all CSP: any external reference is a widget that never
    // renders, and the failure would only show up in someone's transcript.
    expect(content.text).not.toMatch(/src=["']https?:/i);
    expect(content.text).not.toMatch(/href=["']https?:/i);
    expect(content.text).not.toContain('@import url(');
  });

  it('speaks the extension handshake, not an ad-hoc ready signal', async () => {
    const client = await connect(await seedCtx());
    const read = await client.readResource({ uri: 'ui://docket/change-report' });
    const html = (read.contents[0] as { text: string }).text;

    // The literal method names from the spec. Getting any of these wrong means the card renders
    // blank against a conforming host, which no unit test of its markup would catch.
    expect(html).toContain('ui/initialize');
    expect(html).toContain('ui/notifications/initialized');
    expect(html).toContain('ui/notifications/tool-result');
    expect(html).toContain('ui/notifications/tool-input');
    expect(html).toContain('ui/update-model-context');
    expect(html).not.toContain('iframe-ready');
    // ChatGPT's Apps SDK, which this is deliberately not.
    expect(html).not.toContain('window.openai');
    expect(html).not.toContain('text/html+skybridge');
  });

  it('refuses a subscription to a widget, which never changes', async () => {
    const client = await connect(await seedCtx());
    await expect(client.subscribeResource({ uri: 'ui://docket/change-report' })).rejects.toThrow();
  });
});

describe('tool → widget linkage', () => {
  it('points every write that reports a change set at the change-report card', async () => {
    const client = await connect(await seedCtx());
    const tools = await allTools(client);
    const uriFor = (name: string): string | undefined => {
      const meta = tools.find((t) => t.name === name)?._meta as
        | Record<string, { resourceUri?: string }>
        | undefined;
      return meta?.[UI_EXTENSION]?.resourceUri;
    };

    for (const name of ['capture', 'update', 'organize', 'archive']) {
      expect(uriFor(name), `${name} should render through the change report`).toBe(
        'ui://docket/change-report',
      );
    }
    expect(uriFor('list_work')).toBe('ui://docket/work-list');
    expect(uriFor('get')).toBe('ui://docket/entity');
    expect(uriFor('plan_day')).toBe('ui://docket/plan');
    for (const [tool, uri] of [
      ['get_tasks', 'ui://docket/tasks'],
      ['get_projects', 'ui://docket/projects'],
      ['get_programs', 'ui://docket/programs'],
      ['get_initiatives', 'ui://docket/initiatives'],
      ['get_cycles', 'ui://docket/cycles'],
      ['get_teams', 'ui://docket/teams'],
      ['get_updates', 'ui://docket/updates'],
      ['get_comments', 'ui://docket/comments'],
      ['get_sessions', 'ui://docket/sessions'],
      ['get_agents', 'ui://docket/agents'],
      ['get_views', 'ui://docket/views'],
      ['get_organizations', 'ui://docket/organizations'],
    ] as const) {
      expect(uriFor(tool), `${tool} should render through its semantic view`).toBe(uri);
    }
  });

  it('never points a tool at a widget that is not registered', async () => {
    const client = await connect(await seedCtx());
    const registered = new Set<string>(
      (await allResources(client))
        .map((resource) => resource.uri)
        .filter((uri): uri is string => uri.startsWith('ui://')),
    );

    for (const tool of await allTools(client)) {
      const meta = tool._meta as Record<string, { resourceUri?: string }> | undefined;
      const uri = meta?.[UI_EXTENSION]?.resourceUri;
      if (uri === undefined) continue;
      expect(registered, `${tool.name} names ${uri}`).toContain(uri);
    }
  });

  it('leaves tools without a widget carrying no ui meta at all', async () => {
    const client = await connect(await seedCtx());
    const tools = await allTools(client);
    const meta = tools.find((t) => t.name === 'undo')?._meta as Record<string, unknown> | undefined;
    // `undo` is invoked *from* a card; giving it one of its own would nest a report in a report.
    expect(meta?.[UI_EXTENSION]).toBeUndefined();
  });
});

describe('spec spelling of the tool → widget metadata', () => {
  it('carries the linkage under the stable spec key as well as the extension id', async () => {
    const client = await connect(await seedCtx());
    const tools = await allTools(client);
    const meta = tools.find((t) => t.name === 'list_work')?._meta as
      | Record<string, { resourceUri?: string }>
      | undefined;

    // The stable specification (2026-01-26) spells the linkage `_meta.ui`. The full extension id
    // is kept alongside it for hosts written against the pre-stable drafts; `_meta` is an open
    // map, so carrying both is how one declaration renders in either generation of host.
    expect(meta?.['ui']?.resourceUri).toBe('ui://docket/work-list');
    expect(meta?.[UI_EXTENSION]?.resourceUri).toBe('ui://docket/work-list');
  });

  it('keeps semantic tools model-visible while confining legacy get to app callers', async () => {
    const client = await connect(await seedCtx());
    const tools = await allTools(client);
    for (const tool of tools) {
      const meta = tool._meta as Record<string, Record<string, unknown>> | undefined;
      const ui = meta?.['ui'];
      if (!ui) continue;
      if (tool.name === 'get') {
        expect(ui['visibility']).toEqual(['app']);
      } else {
        // An absent field is the spec's own way of saying `["model", "app"]`.
        expect(ui['visibility'], `${tool.name} should be model-visible`).toBeUndefined();
      }
    }
  });
});
