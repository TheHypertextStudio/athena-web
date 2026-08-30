/**
 * Manual public-endpoint interoperability proof for the pinned official map server.
 *
 * @remarks
 * Start `@modelcontextprotocol/server-map@1.7.5`, expose it through an ephemeral HTTPS endpoint,
 * then set `MCP_MAP_INTEROP_URL` to its `/mcp` URL. The production connector is deliberately used
 * here, including its public-address-only DNS and response-size boundary. A localhost URL is not a
 * valid substitute because Athena must reject it as SSRF.
 */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { RealMcpConnector, type RemoteMcpSession } from '../../src/mcp-connector';

interface MapBounds {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
  readonly label: string;
}

/** Credential-free interoperability evidence safe to retain in release notes. */
export interface MapInteropEvidence {
  readonly server: ReturnType<RemoteMcpSession['serverInfo']>;
  readonly tools: readonly string[];
  readonly resourceUri: string;
  readonly mimeType: string;
  readonly geocodeFallback: string;
  readonly textFallback: string;
}

/** Parse the first bounding box returned by the pinned server's documented geocode text result. */
function firstGeocodeBounds(content: string): MapBounds | null {
  const match =
    /^1\. (.+)\n\s+Coordinates: -?\d+(?:\.\d+)?, -?\d+(?:\.\d+)?\n\s+Bounding box: W:(-?\d+(?:\.\d+)?), S:(-?\d+(?:\.\d+)?), E:(-?\d+(?:\.\d+)?), N:(-?\d+(?:\.\d+)?)/m.exec(
      content,
    );
  if (!match) return null;
  const [, label = '', westText, southText, eastText, northText] = match;
  const [west, south, east, north] = [westText, southText, eastText, northText].map(Number);
  if (
    !label ||
    [west, south, east, north].some((value) => !Number.isFinite(value)) ||
    west === undefined ||
    south === undefined ||
    east === undefined ||
    north === undefined ||
    west >= east ||
    south >= north
  ) {
    return null;
  }
  return { west, south, east, north, label };
}

/** Exercise geocode then show-map through one real connector session. */
export async function runMapInterop(session: RemoteMcpSession): Promise<MapInteropEvidence> {
  const tools = await session.listTools();
  const showMap = tools.find((tool) => tool.name === 'show-map');
  if (!showMap?.ui?.resourceUri)
    throw new Error('Pinned map server did not advertise show-map UI.');
  if (!tools.some((tool) => tool.name === 'geocode')) {
    throw new Error('Pinned map server did not advertise geocode.');
  }
  const geocode = await session.callTool('geocode', { query: 'Las Vegas' });
  const bounds = geocode.isError ? null : firstGeocodeBounds(geocode.content);
  if (!bounds) {
    throw new Error('Pinned map server geocode did not return meaningful coordinates and bounds.');
  }
  const result = await session.callTool('show-map', bounds, {
    connectionId: 'manual-map-interop',
    serverName: session.serverInfo().name,
  });
  if (result.isError || !result.content.includes('Displaying globe at:')) {
    throw new Error('Pinned map server did not return its meaningful text fallback.');
  }
  if (result.presentation?.resource.uri !== showMap.ui.resourceUri) {
    throw new Error('Athena did not retain the map server UI resource beside the original result.');
  }
  return {
    server: session.serverInfo(),
    tools: tools.map((tool) => tool.name).sort(),
    resourceUri: result.presentation.resource.uri,
    mimeType: result.presentation.resource.mimeType,
    geocodeFallback: geocode.content,
    textFallback: result.content,
  };
}

async function main(): Promise<void> {
  const url = process.env['MCP_MAP_INTEROP_URL'];
  if (!url) {
    throw new Error(
      'Set MCP_MAP_INTEROP_URL to the public HTTPS /mcp endpoint for @modelcontextprotocol/server-map@1.7.5.',
    );
  }
  if (new URL(url).protocol !== 'https:') {
    throw new Error(
      'MCP_MAP_INTEROP_URL must use public HTTPS; localhost/private HTTP is rejected.',
    );
  }
  const session = await new RealMcpConnector().open({
    url,
    ...(process.env['MCP_MAP_INTEROP_BEARER_TOKEN']
      ? { bearerToken: process.env['MCP_MAP_INTEROP_BEARER_TOKEN'] }
      : {}),
  });
  try {
    process.stdout.write(`${JSON.stringify(await runMapInterop(session))}\n`);
  } finally {
    await session.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
