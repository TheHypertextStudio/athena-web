import { describe, expect, it, vi } from 'vitest';
import { listAllMcpTools, listConnectedMcpTools } from '../../src/agent/list-mcp-tools';

const tool = (name: string) => ({
  name,
  inputSchema: { type: 'object' as const, properties: {} },
});
describe('complete first-party MCP discovery', () => {
  it('follows every page and retains schemas, annotations and transport metadata verbatim', async () => {
    const first = {
      ...tool('capture'),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    };
    const last = {
      ...tool('gallery_install'),
      description: 'Install a template',
      annotations: { readOnlyHint: false },
      _meta: { ui: { resourceUri: 'ui://templates/install' } },
      execution: { taskSupport: 'optional' as const },
    };
    const listTools = vi
      .fn()
      .mockResolvedValueOnce({ tools: [first], nextCursor: 'page-two' })
      .mockResolvedValueOnce({ tools: [tool('manage_work_schedule')], nextCursor: 'page-three' })
      .mockResolvedValueOnce({ tools: [last] });
    const tools = await listAllMcpTools({ listTools });
    expect(tools.map((entry) => entry.name)).toEqual([
      'capture',
      'manage_work_schedule',
      'gallery_install',
    ]);
    expect(tools[0]).toBe(first);
    expect(tools[2]).toBe(last);
    expect(listTools.mock.calls).toEqual([
      [],
      [{ cursor: 'page-two' }],
      [{ cursor: 'page-three' }],
    ]);
  });
  it('continues past an empty intermediate page', async () => {
    const listTools = vi
      .fn()
      .mockResolvedValueOnce({ tools: [], nextCursor: 'next' })
      .mockResolvedValueOnce({ tools: [tool('last')] });
    expect((await listAllMcpTools({ listTools })).map((entry) => entry.name)).toEqual(['last']);
  });
  it('rejects a repeated cursor rather than looping or silently dropping tools', async () => {
    const listTools = vi.fn().mockResolvedValue({ tools: [], nextCursor: 'same' });
    await expect(listAllMcpTools({ listTools })).rejects.toThrow('repeated a cursor');
    expect(listTools).toHaveBeenCalledTimes(2);
  });
  it('propagates a failed later page instead of returning a partial toolbox', async () => {
    const failure = new Error('page unavailable');
    const listTools = vi
      .fn()
      .mockResolvedValueOnce({ tools: [tool('first')], nextCursor: 'next' })
      .mockRejectedValueOnce(failure);
    await expect(listAllMcpTools({ listTools })).rejects.toBe(failure);
  });
  it('closes both owned endpoints after failed discovery without hiding the original failure', async () => {
    const failure = new Error('catalog unavailable');
    const client = {
      listTools: vi.fn().mockRejectedValue(failure),
      close: vi.fn().mockRejectedValue(new Error('cleanup failed')),
    };
    const server = { close: vi.fn().mockResolvedValue(undefined) };
    await expect(listConnectedMcpTools(client, server)).rejects.toBe(failure);
    expect(client.close).toHaveBeenCalledOnce();
    expect(server.close).toHaveBeenCalledOnce();
  });
  it('leaves a successfully discovered connection open for tool calls', async () => {
    const client = {
      listTools: vi.fn().mockResolvedValue({ tools: [tool('capture')] }),
      close: vi.fn(),
    };
    const server = { close: vi.fn() };
    expect((await listConnectedMcpTools(client, server)).map((entry) => entry.name)).toEqual([
      'capture',
    ]);
    expect(client.close).not.toHaveBeenCalled();
    expect(server.close).not.toHaveBeenCalled();
  });
});
