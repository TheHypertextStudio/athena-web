import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

/** Read the complete SDK tool records before the toolbox projects definitions and annotations. */
export async function listAllMcpTools(
  client: Pick<Client, 'listTools'>,
): Promise<Awaited<ReturnType<Client['listTools']>>['tools']> {
  let page = await client.listTools();
  const tools = [...page.tools];
  const seen = new Set<string>();
  while (page.nextCursor) {
    if (seen.has(page.nextCursor)) throw new Error('MCP tool listing repeated a cursor');
    seen.add(page.nextCursor);
    page = await client.listTools({ cursor: page.nextCursor });
    tools.push(...page.tools);
  }
  return tools;
}

/** Close both owned transport endpoints if discovery fails, retaining the original error. */
export async function listConnectedMcpTools(
  client: Pick<Client, 'listTools' | 'close'>,
  server: { close(): Promise<void> },
): Promise<Awaited<ReturnType<Client['listTools']>>['tools']> {
  try {
    return await listAllMcpTools(client);
  } catch (cause) {
    await Promise.allSettled([client.close(), server.close()]);
    throw cause;
  }
}
