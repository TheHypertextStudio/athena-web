import { describe, expect, it, vi } from 'vitest';

import { createMcpSafeFetch, type McpDnsLookup, type McpPinnedRequest } from '../src/mcp-network';

const publicLookup: McpDnsLookup = async () => [{ address: '93.184.216.34', family: 4 }];

function response(body = '{}', init: ResponseInit = {}): McpPinnedRequest {
  return vi.fn(async () => new Response(body, init));
}

describe('MCP outbound network policy', () => {
  it('requires HTTPS', async () => {
    const safeFetch = createMcpSafeFetch({ lookup: publicLookup, request: response() });
    await expect(safeFetch('http://example.com/mcp')).rejects.toThrow(/HTTPS/i);
  });

  it.each([
    ['localhost', '127.0.0.1'],
    ['loopback IPv4', '127.0.0.2'],
    ['RFC1918 10/8', '10.1.2.3'],
    ['RFC1918 172.16/12', '172.31.255.1'],
    ['RFC1918 192.168/16', '192.168.2.1'],
    ['CGNAT', '100.64.1.1'],
    ['link-local metadata', '169.254.169.254'],
    ['IPv6 loopback', '::1'],
    ['IPv6 unique-local', 'fc00::1'],
    ['IPv6 link-local', 'fe80::1'],
    ['IPv4-mapped private', '::ffff:192.168.1.10'],
    ['IPv4-mapped private hex', '::ffff:a00:1'],
  ])('rejects %s destinations', async (_label, address) => {
    const lookup: McpDnsLookup = async () => [{ address, family: address.includes(':') ? 6 : 4 }];
    const request = response();
    const safeFetch = createMcpSafeFetch({ lookup, request });
    await expect(safeFetch('https://blocked.example/mcp')).rejects.toThrow(/not public/i);
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects a hostname when any resolved address is private', async () => {
    const lookup: McpDnsLookup = async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ];
    const request = response();
    await expect(
      createMcpSafeFetch({ lookup, request })('https://mixed.example/mcp'),
    ).rejects.toThrow(/not public/i);
    expect(request).not.toHaveBeenCalled();
  });

  it('pins the validated address instead of resolving again at connect time', async () => {
    const lookup = vi.fn<McpDnsLookup>(async () => [{ address: '93.184.216.34', family: 4 }]);
    const request = vi.fn<McpPinnedRequest>(async (_url, _init, address) => {
      expect(address).toBe('93.184.216.34');
      return new Response('ok');
    });
    const result = await createMcpSafeFetch({ lookup, request })('https://public.example/mcp');
    expect(await result.text()).toBe('ok');
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('revalidates every redirect and rejects a redirect to a private host', async () => {
    const lookup: McpDnsLookup = async (hostname) =>
      hostname === 'public.example'
        ? [{ address: '93.184.216.34', family: 4 }]
        : [{ address: '169.254.169.254', family: 4 }];
    const request = vi.fn<McpPinnedRequest>(async () =>
      Response.redirect('https://metadata.example/latest/meta-data', 302),
    );
    await expect(
      createMcpSafeFetch({ lookup, request })('https://public.example/mcp'),
    ).rejects.toThrow(/not public/i);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('enforces a strict redirect count', async () => {
    const request = vi.fn<McpPinnedRequest>(async (url) =>
      Response.redirect(`https://public.example/${Number(url.pathname.slice(1) || 0) + 1}`, 302),
    );
    await expect(
      createMcpSafeFetch({ lookup: publicLookup, request, limits: { maxRedirects: 2 } })(
        'https://public.example/0',
      ),
    ).rejects.toThrow(/redirect/i);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('enforces the overall timeout', async () => {
    const request = vi.fn<McpPinnedRequest>(
      async (_url, _init, _address, signal) =>
        await new Promise<Response>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
            },
            { once: true },
          );
        }),
    );
    await expect(
      createMcpSafeFetch({
        lookup: publicLookup,
        request,
        limits: { overallTimeoutMs: 5 },
      })('https://public.example/mcp'),
    ).rejects.toThrow(/timed out/i);
  });

  it('enforces the overall timeout while consuming a response body', async () => {
    const request = vi.fn<McpPinnedRequest>(async (_url, _init, _address, signal) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          signal.addEventListener(
            'abort',
            () => {
              controller.error(signal.reason);
            },
            { once: true },
          );
          controller.enqueue(new TextEncoder().encode('partial'));
        },
      });
      return new Response(body);
    });
    const result = await createMcpSafeFetch({
      lookup: publicLookup,
      request,
      limits: { overallTimeoutMs: 5 },
    })('https://public.example/mcp');
    await expect(result.text()).rejects.toThrow(/timed out/i);
  });

  it('rejects oversized response headers and bodies', async () => {
    const headerRequest = response('{}', { headers: { 'x-large': 'x'.repeat(128) } });
    await expect(
      createMcpSafeFetch({
        lookup: publicLookup,
        request: headerRequest,
        limits: { maxHeaderBytes: 64 },
      })('https://public.example/mcp'),
    ).rejects.toThrow(/header/i);

    const bodyRequest = response('x'.repeat(128), { headers: { 'content-length': '128' } });
    const bodyResponse = await createMcpSafeFetch({
      lookup: publicLookup,
      request: bodyRequest,
      limits: { maxBodyBytes: 64 },
    })('https://public.example/mcp');
    await expect(bodyResponse.text()).rejects.toThrow(/body/i);
  });

  it('allows a public HTTPS destination', async () => {
    const request = response('{"ok":true}', { status: 200 });
    const result = await createMcpSafeFetch({ lookup: publicLookup, request })(
      'https://public.example/mcp',
    );
    expect(await result.json()).toEqual({ ok: true });
    expect(request).toHaveBeenCalledOnce();
  });
});
