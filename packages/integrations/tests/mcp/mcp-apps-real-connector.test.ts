/**
 * Stable resource validation through the real MCP SDK-backed connector boundary.
 *
 * @remarks
 * The MCP client and HTTP transport are the external network edge, so this test replaces only
 * those two objects. The production {@link RealMcpConnector} still opens its real session and
 * performs the resource decoding, metadata validation, and renderability decision under test.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MCP_UI_MIME_TYPE } from '@docket/types';

const sdkState = vi.hoisted<{
  contents: unknown[];
  tools: unknown[];
  result: Record<string, unknown>;
  calls: number;
}>(() => ({
  contents: [],
  tools: [],
  result: { content: [] },
  calls: 0,
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class FakeExternalMcpClient {
    connect(): Promise<void> {
      return Promise.resolve();
    }

    getServerVersion(): { name: string; version: string } {
      return { name: 'external-test-server', version: '1.0.0' };
    }

    listTools(): Promise<{ tools: unknown[] }> {
      return Promise.resolve({ tools: sdkState.tools });
    }

    callTool(): Promise<Record<string, unknown>> {
      sdkState.calls += 1;
      return Promise.resolve(sdkState.result);
    }

    readResource(): Promise<{ contents: unknown[] }> {
      return Promise.resolve({ contents: sdkState.contents });
    }

    close(): Promise<void> {
      return Promise.resolve();
    }
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class FakeExternalTransport {
    close(): Promise<void> {
      return Promise.resolve();
    }
  },
}));

import {
  MCP_APP_PRESENTATION_MAX_BYTES,
  normalizeMcpAppPresentation,
  RealMcpConnector,
} from '../../src/mcp-connector';

const PRESENTATION_INPUT = {
  context: { connectionId: 'connection-1', serverName: 'Weather Service' },
  tool: {
    name: 'weather_card',
    description: 'Show the weather.',
    inputSchema: { type: 'object' },
  },
  arguments: { city: 'Las Vegas' },
  result: { content: [{ type: 'text' as const, text: '72 degrees' }], isError: false },
  resource: {
    uri: 'ui://external/weather',
    mimeType: MCP_UI_MIME_TYPE,
    text: '<!doctype html><title>Weather</title>',
  },
};

beforeEach(() => {
  sdkState.contents = [];
  sdkState.tools = [];
  sdkState.result = { content: [] };
  sdkState.calls = 0;
});

describe('RealMcpConnector MCP App resources', () => {
  it('keeps JSON-safe repeated argument values without mistaking them for a cycle', () => {
    const shared = { city: 'Las Vegas' };
    const presentation = normalizeMcpAppPresentation({
      ...PRESENTATION_INPUT,
      arguments: { primary: shared, fallback: shared },
    });

    expect(presentation?.arguments).toEqual({ primary: shared, fallback: shared });
  });

  it.each([
    ['credential-bearing arguments', { arguments: { authorization: 'Bearer secret' } }],
    [
      'credential-bearing raw results',
      {
        result: {
          content: [{ type: 'text' as const, text: '72 degrees' }],
          structuredContent: { bearerToken: 'secret' },
        },
      },
    ],
    [
      'a presentation above two MiB',
      {
        resource: {
          ...PRESENTATION_INPUT.resource,
          text: 'x'.repeat(MCP_APP_PRESENTATION_MAX_BYTES),
        },
      },
    ],
    ['an invalid raw result', { result: { content: [{ type: 'provider-private-block' }] } }],
  ])('omits %s while preserving the caller-owned text fallback', (_label, override) => {
    expect(normalizeMcpAppPresentation({ ...PRESENTATION_INPUT, ...override })).toBeUndefined();
  });

  it('omits cyclic arguments instead of attempting to persist them', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(
      normalizeMcpAppPresentation({ ...PRESENTATION_INPUT, arguments: cyclic }),
    ).toBeUndefined();
  });

  it('rejects a resource whose declared stable metadata is invalid', async () => {
    sdkState.contents = [
      {
        uri: 'ui://external/card',
        mimeType: MCP_UI_MIME_TYPE,
        text: '<!doctype html><title>External card</title>',
        _meta: { ui: { csp: { connectDomains: [7] } } },
      },
    ];
    const session = await new RealMcpConnector().open({
      url: 'https://external.example/mcp',
    });

    await expect(session.readUiResource?.('ui://external/card')).resolves.toBeNull();
    await session.close();
  });

  it('snapshots valid base64 widget HTML beside the one raw tool result', async () => {
    sdkState.tools = [
      {
        name: 'weather_card',
        description: 'Show the weather.',
        inputSchema: { type: 'object' },
        _meta: { ui: { resourceUri: 'ui://external/weather' } },
      },
    ];
    sdkState.result = {
      content: [{ type: 'text', text: '72 degrees' }],
      structuredContent: { temperature: 72 },
      isError: false,
    };
    sdkState.contents = [
      {
        uri: 'ui://external/weather',
        mimeType: MCP_UI_MIME_TYPE,
        blob: Buffer.from('<!doctype html><title>Weather</title>').toString('base64'),
        _meta: {
          ui: {
            csp: { connectDomains: ['https://weather.example'] },
            permissions: { geolocation: {} },
            domain: 'weather.example',
            prefersBorder: true,
            providerSecret: 'must-not-survive',
          },
        },
      },
    ];
    const session = await new RealMcpConnector().open({
      url: 'https://external.example/mcp',
    });

    await session.listTools();
    const result = await session.callTool(
      'weather_card',
      { city: 'Las Vegas' },
      {
        connectionId: 'connection-1',
        serverName: 'Weather Service',
      },
    );

    expect(sdkState.calls).toBe(1);
    expect(result.content).toBe('72 degrees');
    expect(result.presentation).toEqual({
      connectionId: 'connection-1',
      serverName: 'Weather Service',
      tool: 'weather_card',
      arguments: { city: 'Las Vegas' },
      result: sdkState.result,
      resource: {
        uri: 'ui://external/weather',
        mimeType: MCP_UI_MIME_TYPE,
        text: '<!doctype html><title>Weather</title>',
        meta: {
          csp: { connectDomains: ['https://weather.example'] },
          permissions: { geolocation: {} },
          domain: 'weather.example',
          prefersBorder: true,
        },
      },
    });
    expect(JSON.stringify(result.presentation)).not.toContain('providerSecret');
    await session.close();
  });

  it('marks a declared app unavailable when its snapshot exceeds the bound', async () => {
    sdkState.tools = [
      {
        name: 'weather_card',
        description: 'Show the weather.',
        inputSchema: { type: 'object' },
        _meta: { ui: { resourceUri: 'ui://external/weather' } },
      },
    ];
    sdkState.result = { content: [{ type: 'text', text: '72 degrees' }] };
    sdkState.contents = [
      {
        uri: 'ui://external/weather',
        mimeType: MCP_UI_MIME_TYPE,
        text: 'x'.repeat(MCP_APP_PRESENTATION_MAX_BYTES),
      },
    ];
    const session = await new RealMcpConnector().open({ url: 'https://external.example/mcp' });

    const result = await session.callTool('weather_card', {}, PRESENTATION_INPUT.context);

    expect(result).toMatchObject({
      content: '72 degrees',
      presentationUnavailable: true,
    });
    expect(result.presentation).toBeUndefined();
    expect(sdkState.calls).toBe(1);
    await session.close();
  });
});
