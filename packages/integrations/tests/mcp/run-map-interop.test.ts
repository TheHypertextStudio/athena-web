/** Behavioral contract for the manual official map-server interoperability runner. */
import { describe, expect, it, vi } from 'vitest';

import { runMapInterop } from './run-map-interop';

describe('official map interoperability runner', () => {
  it('geocodes a place and uses the returned bounds for the retained show-map presentation', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValueOnce({
        content:
          '1. Las Vegas, Nevada\n   Coordinates: 36.171600, -115.139100\n   Bounding box: W:-115.4000, S:35.9000, E:-114.9000, N:36.4000',
        isError: false,
      })
      .mockResolvedValueOnce({
        content: 'Displaying globe at: Las Vegas, Nevada',
        isError: false,
        presentation: {
          resource: {
            uri: 'ui://cesium-map/mcp-app.html',
            mimeType: 'text/html;profile=mcp-app',
          },
        },
      });
    const session = {
      listTools: vi.fn(async () => [
        { name: 'geocode', description: 'Geocode', inputSchema: {} },
        {
          name: 'show-map',
          description: 'Show map',
          inputSchema: {},
          ui: { resourceUri: 'ui://cesium-map/mcp-app.html' },
        },
      ]),
      callTool,
      serverInfo: () => ({ name: 'official-map', version: '1.7.5' }),
    };

    const evidence = await runMapInterop(session as never);

    expect(callTool).toHaveBeenNthCalledWith(1, 'geocode', { query: 'Las Vegas' });
    expect(callTool).toHaveBeenNthCalledWith(
      2,
      'show-map',
      {
        west: -115.4,
        south: 35.9,
        east: -114.9,
        north: 36.4,
        label: 'Las Vegas, Nevada',
      },
      { connectionId: 'manual-map-interop', serverName: 'official-map' },
    );
    expect(evidence).toMatchObject({
      resourceUri: 'ui://cesium-map/mcp-app.html',
      textFallback: 'Displaying globe at: Las Vegas, Nevada',
    });
  });
});
