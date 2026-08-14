/**
 * The MCP Apps host routes — what the browser is allowed to make a connected server do.
 *
 * @remarks
 * The security property under test is the one the browser cannot enforce for itself: a widget's
 * `tools/call` is checked against the tool list of the connection the widget came from. These
 * tests drive `runWidgetTool` directly rather than through Hono, because the interesting
 * decisions (ownership, advertised, view-callable) all happen below the router and driving them
 * directly makes each refusal a separate, unambiguous assertion.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

const getSession = vi.fn(async () => null);
vi.mock('@docket/auth', () => ({ auth: { api: { getSession } } }));

import type * as DbModule from '@docket/db';
import { WIDGET_FIXTURE_URI } from '@docket/integrations';

import type {
  isAppCallableTool as IsAppCallableTool,
  runWidgetTool as RunWidgetTool,
} from '../../src/mcp/apps/host-routes';
import { getMigratedDb } from '../support/db';
import { assertDefined } from '@docket/test-utils';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let runWidgetTool!: typeof RunWidgetTool;
let isAppCallableTool!: typeof IsAppCallableTool;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
  // The container resolves `MockMcpConnector` in test mode, which serves the widget fixture at
  // `mcp.acme-release.example` — a third-party MCP Apps server standing in for a real one, so the
  // whole path (list, call, read the `ui://` document) runs without depending on anyone's uptime.
  ({ runWidgetTool, isAppCallableTool } = await import('../../src/mcp/apps/host-routes'));
});

/** Seed a user with one connected personal MCP connection at `url`. */
async function seedConnection(url: string): Promise<{ userId: string; connectionId: string }> {
  const slug = `mh-${Math.random().toString(36).slice(2, 10)}`;
  const [user] = await db
    .insert(schema.user)
    .values({ name: 'Ada', email: `${slug}@example.com` })
    .returning({ id: schema.user.id });
  const [row] = await db
    .insert(schema.personalMcpConnection)
    .values({
      ownerUserId: assertDefined(user).id,
      url,
      name: 'Acme Release Tracker',
      alias: slug.replace(/-/g, ''),
      authMode: 'none',
      status: 'connected',
      toolCount: 2,
    })
    .returning({ id: schema.personalMcpConnection.id });
  return { userId: assertDefined(user).id, connectionId: assertDefined(row).id };
}

describe('rendering a widget-bearing tool', () => {
  it('returns the ui:// document the tool declares alongside its result', async () => {
    const { userId, connectionId } = await seedConnection('https://mcp.acme-release.example/mcp');
    const render = await runWidgetTool(userId, connectionId, 'release_checklist', {}, false);

    expect(render.resource?.uri).toBe(WIDGET_FIXTURE_URI);
    expect(render.resource?.mimeType).toBe('text/html;profile=mcp-app');
    expect(render.resource?.text).toContain('ui/initialize');
    // The declared preference travels with the document, not as a host guess.
    expect(render.resource?.prefersBorder).toBe(true);
    // The structured result is preserved, not flattened to text — a widget renders from it.
    expect(render.result['structuredContent']).toMatchObject({ title: 'Release 4.2 checklist' });
    expect(render.arguments).toEqual({});
  });

  it('refuses a connection that belongs to somebody else, as a miss rather than a denial', async () => {
    const mine = await seedConnection('https://mcp.acme-release.example/mcp');
    const theirs = await seedConnection('https://mcp.acme-release.example/mcp');
    await expect(
      runWidgetTool(mine.userId, theirs.connectionId, 'release_checklist', {}, false),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('refuses a tool the server does not advertise, naming it', async () => {
    const { userId, connectionId } = await seedConnection('https://mcp.acme-release.example/mcp');
    await expect(
      runWidgetTool(userId, connectionId, 'delete_everything', {}, false),
    ).rejects.toMatchObject({ status: 404, message: expect.stringContaining('delete_everything') });
  });
});

describe('view-initiated calls', () => {
  it('runs a tool the server marks view-callable and reflects the change it made', async () => {
    const { userId, connectionId } = await seedConnection('https://mcp.acme-release.example/mcp');
    const before = await runWidgetTool(userId, connectionId, 'release_checklist', {}, false);
    const steps = (before.result['structuredContent'] as { steps: { done: boolean }[] }).steps;
    const doneBefore = steps.filter((step) => step.done).length;

    const after = await runWidgetTool(userId, connectionId, 'advance_release', {}, true);
    const afterSteps = (after.result['structuredContent'] as { steps: { done: boolean }[] }).steps;
    expect(afterSteps.filter((step) => step.done)).toHaveLength(doneBefore + 1);
  });

  it('refuses a model-only tool when a view asks for it, though the model may call it', async () => {
    const { userId, connectionId } = await seedConnection('https://mcp.acme-release.example/mcp');

    // The view path is refused, with the tool named…
    await expect(
      runWidgetTool(userId, connectionId, 'abandon_release', {}, true),
    ).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining('abandon_release'),
    });
    // …while the model path, which the server does permit, is allowed.
    await expect(
      runWidgetTool(userId, connectionId, 'abandon_release', {}, false),
    ).resolves.toBeDefined();
  });

  it('reads the spec default when a tool declares no visibility at all', () => {
    // "visibility defaults to ["model", "app"] if omitted" — absent means view-callable.
    expect(isAppCallableTool({ name: 'x', description: 'x', inputSchema: {}, ui: {} })).toBe(true);
    expect(isAppCallableTool({ name: 'x', description: 'x', inputSchema: {} })).toBe(true);
    expect(
      isAppCallableTool({
        name: 'x',
        description: 'x',
        inputSchema: {},
        ui: { visibility: ['model'] },
      }),
    ).toBe(false);
    expect(
      isAppCallableTool({
        name: 'x',
        description: 'x',
        inputSchema: {},
        ui: { visibility: ['model', 'app'] },
      }),
    ).toBe(true);
  });
});
