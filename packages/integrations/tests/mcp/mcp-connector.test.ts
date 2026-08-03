import { describe, expect, it } from 'vitest';

import { MockMcpConnector, RealMcpConnector, SUNSAMA_BACKLOG } from '../../src';

describe('MockMcpConnector', () => {
  it('serves the Sunsama fixture server by endpoint host, regardless of path', async () => {
    const connector = new MockMcpConnector();
    const session = await connector.open({ url: 'https://mcp.sunsama.com/v1/mcp' });
    const tools = await session.listTools();
    expect(tools.map((t) => t.name)).toEqual(['get_backlog_tasks', 'get_task_by_id']);
    // Every Sunsama fixture tool is read-only — imports never write back to the source.
    for (const tool of tools) expect(tool.annotations?.readOnlyHint).toBe(true);
    await session.close();
  });

  it('returns the deterministic backlog from get_backlog_tasks', async () => {
    const connector = new MockMcpConnector();
    const session = await connector.open({ url: 'https://mcp.sunsama.com/mcp' });
    const result = await session.callTool('get_backlog_tasks', {});
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content)).toEqual(SUNSAMA_BACKLOG);
  });

  it('resolves get_task_by_id and errors on unknown ids/tools', async () => {
    const connector = new MockMcpConnector();
    const session = await connector.open({ url: 'https://mcp.sunsama.com/mcp' });
    const hit = await session.callTool('get_task_by_id', { taskId: 'su-002' });
    expect(hit.isError).toBe(false);
    expect(JSON.parse(hit.content).title).toBe('Book the venue for the offsite');

    expect((await session.callTool('get_task_by_id', { taskId: 'nope' })).isError).toBe(true);
    expect((await session.callTool('unknown_tool', {})).isError).toBe(true);
    // No taskId at all (not even an object) — the input guard fails closed to "not found".
    expect((await session.callTool('get_task_by_id', undefined)).isError).toBe(true);
  });

  it('throws on unknown hosts and invalid URLs (never reports success falsely)', async () => {
    const connector = new MockMcpConnector();
    await expect(connector.open({ url: 'https://unknown.example.com/mcp' })).rejects.toThrow(
      /No MCP server reachable/,
    );
    await expect(connector.open({ url: 'not a url' })).rejects.toThrow(/Invalid MCP endpoint/);
  });

  it('accepts extra fixture servers keyed by host', async () => {
    const connector = new MockMcpConnector({
      servers: {
        'mcp.example.com': {
          tools: [
            {
              name: 'echo',
              description: 'Echo.',
              inputSchema: { type: 'object' },
              annotations: { readOnlyHint: true },
            },
          ],
          call: (name, input) => ({ content: JSON.stringify({ name, input }), isError: false }),
        },
      },
    });
    const session = await connector.open({ url: 'https://mcp.example.com/mcp' });
    expect((await session.listTools()).map((t) => t.name)).toEqual(['echo']);
  });

  it('falls back to the host as the name when a fixture server declares no serverInfo, and wraps `call` for callToolRaw when the fixture declares no callRaw', async () => {
    const connector = new MockMcpConnector({
      servers: {
        'mcp.example.com': {
          tools: [
            {
              name: 'echo',
              description: 'Echo.',
              inputSchema: { type: 'object' },
              annotations: { readOnlyHint: true },
            },
          ],
          call: (name, input) => ({ content: JSON.stringify({ name, input }), isError: false }),
        },
      },
    });
    const session = await connector.open({ url: 'https://mcp.example.com/mcp' });
    expect(session.serverInfo()).toEqual({ name: 'mcp.example.com' });

    const raw = await session.callToolRaw?.('echo', { x: 1 });
    expect(raw).toEqual({
      content: [{ type: 'text', text: JSON.stringify({ name: 'echo', input: { x: 1 } }) }],
    });
  });
});

describe('RealMcpConnector network policy', () => {
  it('rejects insecure endpoints before opening a transport', async () => {
    await expect(new RealMcpConnector().open({ url: 'http://127.0.0.1:3000/mcp' })).rejects.toThrow(
      /HTTPS/i,
    );
  });
});
