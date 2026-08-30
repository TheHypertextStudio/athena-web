/**
 * Manual public-endpoint interoperability proof for the pinned official map server.
 *
 * @remarks
 * Start `@modelcontextprotocol/server-map@1.7.5`, expose it through an ephemeral HTTPS endpoint,
 * then set `MCP_MAP_INTEROP_URL` to its `/mcp` URL. The production connector is deliberately used
 * here, including its public-address-only DNS and response-size boundary. A localhost URL is not a
 * valid substitute because Athena must reject it as SSRF.
 */
import { RealMcpConnector } from '../../src/mcp-connector';

const url = process.env['MCP_MAP_INTEROP_URL'];
if (!url) {
  throw new Error(
    'Set MCP_MAP_INTEROP_URL to the public HTTPS /mcp endpoint for @modelcontextprotocol/server-map@1.7.5.',
  );
}
if (new URL(url).protocol !== 'https:') {
  throw new Error('MCP_MAP_INTEROP_URL must use public HTTPS; localhost/private HTTP is rejected.');
}

const connector = new RealMcpConnector();
const session = await connector.open({
  url,
  ...(process.env['MCP_MAP_INTEROP_BEARER_TOKEN']
    ? { bearerToken: process.env['MCP_MAP_INTEROP_BEARER_TOKEN'] }
    : {}),
});

try {
  const tools = await session.listTools();
  const showMap = tools.find((tool) => tool.name === 'show-map');
  if (!showMap?.ui?.resourceUri)
    throw new Error('Pinned map server did not advertise show-map UI.');
  if (!tools.some((tool) => tool.name === 'geocode')) {
    throw new Error('Pinned map server did not advertise geocode.');
  }
  const result = await session.callTool(
    'show-map',
    { west: -115.3, south: 35.9, east: -114.9, north: 36.3, label: 'Las Vegas' },
    { connectionId: 'manual-map-interop', serverName: session.serverInfo().name },
  );
  if (result.isError || !result.content.includes('Displaying globe at:')) {
    throw new Error('Pinned map server did not return its meaningful text fallback.');
  }
  if (result.presentation?.resource.uri !== showMap.ui.resourceUri) {
    throw new Error('Athena did not retain the map server UI resource beside the original result.');
  }
  process.stdout.write(
    `${JSON.stringify({
      server: session.serverInfo(),
      tools: tools.map((tool) => tool.name).sort(),
      resourceUri: result.presentation.resource.uri,
      mimeType: result.presentation.resource.mimeType,
      textFallback: result.content,
    })}\n`,
  );
} finally {
  await session.close();
}
