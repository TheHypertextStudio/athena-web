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

const sdkState = vi.hoisted(() => ({
  contents: [] as unknown[],
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class FakeExternalMcpClient {
    connect(): Promise<void> {
      return Promise.resolve();
    }

    getServerVersion(): { name: string; version: string } {
      return { name: 'external-test-server', version: '1.0.0' };
    }

    listTools(): Promise<{ tools: never[] }> {
      return Promise.resolve({ tools: [] });
    }

    callTool(): Promise<{ content: never[] }> {
      return Promise.resolve({ content: [] });
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

import { RealMcpConnector } from '../../src/mcp-connector';

beforeEach(() => {
  sdkState.contents = [];
});

describe('RealMcpConnector MCP App resources', () => {
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
});
