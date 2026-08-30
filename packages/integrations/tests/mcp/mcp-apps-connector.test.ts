/**
 * What a remote-MCP session exposes to the MCP Apps host.
 *
 * @remarks
 * The connector is the seam where a server's widget declaration becomes something Docket can act
 * on: the client capability that makes a server offer widgets at all, the two `_meta` spellings a
 * tool's declaration may arrive under, and the structured (not flattened) result a widget renders
 * from. Exercised through {@link MockMcpConnector} against the widget fixture, which is the same
 * third-party stand-in the API host-route tests and the dev stack use.
 */
import { describe, expect, it } from 'vitest';

import { MCP_UI_EXTENSION, MCP_UI_META_KEY, MCP_UI_MIME_TYPE } from '@docket/types';

import {
  createWidgetFixtureServer,
  flatten,
  MCP_UI_CLIENT_CAPABILITY,
  MockMcpConnector,
  readUiResourceMeta,
  readUiToolMeta,
  uiMetaSpread,
  WIDGET_FIXTURE_URI,
} from '../../src/mcp-connector';

const ENDPOINT = { url: 'https://mcp.acme-release.example/mcp' };

describe('client capability', () => {
  it('declares the profile mimeType a server checks before registering UI tools', () => {
    // A server that does not see this registers text-only variants, so the declaration is the
    // difference between being offered a widget and being offered JSON.
    expect(MCP_UI_CLIENT_CAPABILITY.mimeTypes).toEqual([MCP_UI_MIME_TYPE]);
  });
});

describe('reading a tool’s UI declaration', () => {
  it('prefers the stable `_meta.ui` spelling', () => {
    expect(readUiToolMeta({ [MCP_UI_META_KEY]: { resourceUri: 'ui://a/b' } })).toEqual({
      resourceUri: 'ui://a/b',
    });
  });

  it('still reads the pre-stable extension-id spelling some servers ship', () => {
    expect(readUiToolMeta({ [MCP_UI_EXTENSION]: { resourceUri: 'ui://a/b' } })).toEqual({
      resourceUri: 'ui://a/b',
    });
  });

  it('takes `_meta.ui` when a server emits both', () => {
    expect(
      readUiToolMeta({
        [MCP_UI_META_KEY]: { resourceUri: 'ui://stable' },
        [MCP_UI_EXTENSION]: { resourceUri: 'ui://legacy' },
      }),
    ).toEqual({ resourceUri: 'ui://stable' });
  });

  it('reads anything malformed as “no declaration” rather than throwing', () => {
    expect(readUiToolMeta(undefined)).toBeNull();
    expect(readUiToolMeta(null)).toBeNull();
    expect(readUiToolMeta('ui')).toBeNull();
    expect(readUiToolMeta({})).toBeNull();
    expect(readUiToolMeta({ ui: 'ui://a/b' })).toBeNull();
    expect(readUiResourceMeta({ ui: { csp: { connectDomains: ['https://x'] } } })).toEqual({
      csp: { connectDomains: ['https://x'] },
    });
    expect(readUiResourceMeta(7)).toBeNull();
  });

  it('validates resource metadata with the official stable schema', () => {
    expect(
      readUiResourceMeta({ ui: { csp: { connectDomains: ['https://api.example.com'] } } }),
    ).toEqual({ csp: { connectDomains: ['https://api.example.com'] } });
    expect(readUiResourceMeta({ ui: { csp: { connectDomains: [7] } } })).toBeNull();
    expect(readUiResourceMeta({ ui: { permissions: { camera: true } } })).toBeNull();
  });
});

describe('uiMetaSpread', () => {
  it('spreads a `{ ui }` key when the tool declares UI metadata', () => {
    expect(uiMetaSpread({ [MCP_UI_META_KEY]: { resourceUri: 'ui://a/b' } })).toEqual({
      ui: { resourceUri: 'ui://a/b' },
    });
  });

  it('spreads to an empty object (no `ui` key at all) when the tool declares none', () => {
    const spread = uiMetaSpread(undefined);
    expect(spread).toEqual({});
    expect('ui' in spread).toBe(false);
  });
});

describe('flatten', () => {
  it('joins every text block and carries isError through', () => {
    expect(
      flatten({
        content: [
          { type: 'text', text: 'first' },
          { type: 'text', text: 'second' },
        ],
        isError: false,
      }),
    ).toEqual({ content: 'first\nsecond', isError: false });
  });

  it('skips non-text content blocks', () => {
    expect(
      flatten({
        content: [
          { type: 'text', text: 'kept' },
          { type: 'image', data: 'base64==', mimeType: 'image/png' },
        ],
        isError: false,
      }),
    ).toEqual({ content: 'kept', isError: false });
  });

  it('normalizes a missing/non-true isError to false', () => {
    expect(flatten({ content: [{ type: 'text', text: 'x' }] })).toEqual({
      content: 'x',
      isError: false,
    });
  });

  it('reports isError: true only when the server set it', () => {
    expect(flatten({ content: [{ type: 'text', text: 'boom' }], isError: true })).toEqual({
      content: 'boom',
      isError: true,
    });
  });
});

describe('a session against a widget-bearing server', () => {
  it('surfaces the ui declaration on the tools it lists', async () => {
    const session = await new MockMcpConnector().open(ENDPOINT);
    const tools = await session.listTools();

    expect(session.serverInfo()).toEqual({ name: 'acme-release', title: 'Acme Release Tracker' });
    expect(tools.find((tool) => tool.name === 'release_checklist')?.ui).toEqual({
      resourceUri: WIDGET_FIXTURE_URI,
    });
    // The spec's visibility rule is carried through, not dropped: this one is model-only.
    expect(tools.find((tool) => tool.name === 'abandon_release')?.ui?.visibility).toEqual([
      'model',
    ]);
    await session.close();
  });

  it('serves the ui:// document with the profile mimeType and its declared policy', async () => {
    const session = await new MockMcpConnector().open(ENDPOINT);
    const resource = await session.readUiResource?.(WIDGET_FIXTURE_URI);

    expect(resource?.mimeType).toBe(MCP_UI_MIME_TYPE);
    expect(resource?.text).toContain('ui/notifications/initialized');
    // Declares no origins at all, which the host turns into a deny-all policy.
    expect(resource?.meta?.csp).toEqual({});
    expect(resource?.meta?.prefersBorder).toBe(true);
    expect(await session.readUiResource?.('ui://acme-release/nope')).toBeNull();
    await session.close();
  });

  it('keeps the structured result a widget renders from, alongside the flattened text', async () => {
    const session = await new MockMcpConnector().open(ENDPOINT);

    const flattened = await session.callTool('release_checklist', {});
    expect(flattened.isError).toBe(false);
    expect(JSON.parse(flattened.content)).toMatchObject({ title: 'Release 4.2 checklist' });

    const raw = await session.callToolRaw?.('release_checklist', {});
    // The agent loop reads text; a widget needs the structure. Both come from one call.
    expect(raw?.['structuredContent']).toMatchObject({ title: 'Release 4.2 checklist' });
    expect(Array.isArray(raw?.['content'])).toBe(true);
    await session.close();
  });

  it('really advances state, so a click inside a card is not a no-op that looks like one', async () => {
    // A fresh server per test: the fixture is stateful on purpose.
    const connector = new MockMcpConnector({
      servers: { 'mcp.acme-release.example': createWidgetFixtureServer() },
    });
    const session = await connector.open(ENDPOINT);
    const done = async (): Promise<number> => {
      const raw = await session.callToolRaw?.('release_checklist', {});
      const steps = (raw?.['structuredContent'] as { steps: { done: boolean }[] }).steps;
      return steps.filter((step) => step.done).length;
    };

    const before = await done();
    await session.callToolRaw?.('advance_release', {});
    expect(await done()).toBe(before + 1);

    await session.callToolRaw?.('abandon_release', {});
    expect(await done()).toBe(0);
    await session.close();
  });

  it('advances through the flattened callTool path too, and is a no-op once every step is done', async () => {
    const connector = new MockMcpConnector({
      servers: { 'mcp.acme-release.example': createWidgetFixtureServer() },
    });
    const session = await connector.open(ENDPOINT);
    const doneCount = async (): Promise<number> => {
      const flattened = await session.callTool('release_checklist', {});
      const steps = (JSON.parse(flattened.content) as { steps: { done: boolean }[] }).steps;
      return steps.filter((step) => step.done).length;
    };

    expect(await doneCount()).toBe(2); // two steps start done in the fixture
    await session.callTool('advance_release', {});
    expect(await doneCount()).toBe(3);
    await session.callTool('advance_release', {});
    expect(await doneCount()).toBe(4); // every step now done
    // A further advance is a no-op — there is no next incomplete step to mark.
    await session.callTool('advance_release', {});
    expect(await doneCount()).toBe(4);

    await session.callTool('abandon_release', {});
    expect(await doneCount()).toBe(0);
    await session.close();
  });

  it('is also a no-op on callToolRaw once every step is already done', async () => {
    const connector = new MockMcpConnector({
      servers: { 'mcp.acme-release.example': createWidgetFixtureServer() },
    });
    const session = await connector.open(ENDPOINT);
    await session.callToolRaw?.('advance_release', {});
    await session.callToolRaw?.('advance_release', {});
    const raw = await session.callToolRaw?.('advance_release', {});
    const steps = (raw?.['structuredContent'] as { steps: { done: boolean }[] }).steps;
    expect(steps.every((step) => step.done)).toBe(true);
    await session.close();
  });

  it('reports an unknown tool as an error rather than an empty success', async () => {
    const session = await new MockMcpConnector().open(ENDPOINT);
    expect((await session.callTool('nope', {})).isError).toBe(true);
    expect((await session.callToolRaw?.('nope', {}))?.['isError']).toBe(true);
    await session.close();
  });
});
