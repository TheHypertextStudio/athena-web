import { describe, expect, it, vi } from 'vitest';

import {
  createMcpSafeFetch,
  type McpDnsLookup,
  type McpPinnedRequest,
} from '../../src/mcp-network';

const publicLookup: McpDnsLookup = async () => [{ address: '93.184.216.34', family: 4 }];

function response(body: string | null = '{}', init: ResponseInit = {}): McpPinnedRequest {
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
    ['IPv6 IETF reserved', '2001:2::1'],
    ['IPv6 documentation', '2001:db8::1'],
    ['IPv6 documentation 3fff', '3fff::1'],
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
    let headerSignal: AbortSignal | undefined;
    const headerRequest = vi.fn<McpPinnedRequest>(async (_url, _init, _address, signal) => {
      headerSignal = signal;
      return new Response('{}', { headers: { 'x-large': 'x'.repeat(128) } });
    });
    await expect(
      createMcpSafeFetch({
        lookup: publicLookup,
        request: headerRequest,
        limits: { maxHeaderBytes: 64 },
      })('https://public.example/mcp'),
    ).rejects.toThrow(/header/i);
    expect(headerSignal?.aborted).toBe(true);

    let bodySignal: AbortSignal | undefined;
    const bodyRequest = vi.fn<McpPinnedRequest>(async (_url, _init, _address, signal) => {
      bodySignal = signal;
      return new Response('x'.repeat(128), { headers: { 'content-length': '128' } });
    });
    const bodyResponse = await createMcpSafeFetch({
      lookup: publicLookup,
      request: bodyRequest,
      limits: { maxBodyBytes: 64 },
    })('https://public.example/mcp');
    await expect(bodyResponse.text()).rejects.toThrow(/body/i);
    expect(bodySignal?.aborted).toBe(true);
  });

  it('allows a public HTTPS destination', async () => {
    const request = response('{"ok":true}', { status: 200 });
    const result = await createMcpSafeFetch({ lookup: publicLookup, request })(
      'https://public.example/mcp',
    );
    expect(await result.json()).toEqual({ ok: true });
    expect(request).toHaveBeenCalledOnce();
  });

  it('allows a globally routable IPv6 destination', async () => {
    const lookup: McpDnsLookup = async () => [{ address: '2606:4700:4700::1111', family: 6 }];
    const result = await createMcpSafeFetch({ lookup, request: response('ok') })(
      'https://public-v6.example/mcp',
    );
    expect(await result.text()).toBe('ok');
  });

  it('allows a globally routable IPv6 destination carrying a zone id', async () => {
    const lookup: McpDnsLookup = async () => [{ address: '2606:4700:4700::1111%eth0', family: 6 }];
    const result = await createMcpSafeFetch({ lookup, request: response('ok') })(
      'https://public-v6.example/mcp',
    );
    expect(await result.text()).toBe('ok');
  });

  it('allows a full (uncompressed, no "::") globally routable IPv6 address', async () => {
    const lookup: McpDnsLookup = async () => [
      { address: '2606:4700:4700:0:0:0:0:1111', family: 6 },
    ];
    const result = await createMcpSafeFetch({ lookup, request: response('ok') })(
      'https://public-v6.example/mcp',
    );
    expect(await result.text()).toBe('ok');
  });

  it('uses a literal IP address in the URL directly, without a DNS lookup', async () => {
    // The lookup fake would fail loudly (an unexpected call) if the code fell through to it;
    // it's never invoked for a literal-IP URL, so its own return value is irrelevant.
    const lookup = vi.fn<McpDnsLookup>(async () => {
      throw new Error('lookup should not be called for a literal IP URL');
    });
    const request = vi.fn<McpPinnedRequest>(async (_url, _init, address) => {
      expect(address).toBe('93.184.216.34');
      return new Response('ok');
    });
    const result = await createMcpSafeFetch({ lookup, request })('https://93.184.216.34/mcp');
    expect(await result.text()).toBe('ok');
    expect(lookup).not.toHaveBeenCalled();
  });

  it('treats a malformed resolver answer as not public (defends a buggy/compromised lookup)', async () => {
    const lookup: McpDnsLookup = async () => [{ address: 'not-an-ip-address', family: 4 }];
    await expect(
      createMcpSafeFetch({ lookup, request: response() })('https://public.example/mcp'),
    ).rejects.toThrow(/not public/i);
  });

  it('rejects on the synchronous abort check when the overall timeout fires between redirect hops', async () => {
    // The DNS/address-resolution abort check is synchronous at the top of the next hop; the
    // realistic way it observes an already-aborted signal is the overall timeout firing while a
    // slow hop is in flight, before the loop resolves the redirect target's address.
    let calls = 0;
    const request = vi.fn<McpPinnedRequest>(async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return Response.redirect('https://public.example/next', 302);
    });
    await expect(
      createMcpSafeFetch({
        lookup: publicLookup,
        request,
        limits: { overallTimeoutMs: 5 },
      })('https://public.example/start'),
    ).rejects.toThrow(/timed out/i);
    expect(calls).toBe(1); // the second hop's address was never resolved — aborted first
  });

  it('rejects when DNS resolution returns no addresses', async () => {
    const lookup: McpDnsLookup = async () => [];
    await expect(
      createMcpSafeFetch({ lookup, request: response() })('https://empty.example/mcp'),
    ).rejects.toThrow(/no addresses/i);
  });

  it('rejects a redirect Location that carries embedded credentials', async () => {
    // The initial URL can't carry credentials at all — the platform `Request` constructor
    // itself rejects that before this module's code runs. A malicious redirect target is the
    // real way `url.username`/`url.password` gets populated: `Location` is parsed with `new
    // URL(location, url)`, which (unlike `Request`) does not reject embedded credentials.
    const request = vi.fn<McpPinnedRequest>(async () =>
      Response.redirect('https://attacker:pwned@public.example/next', 302),
    );
    await expect(
      createMcpSafeFetch({ lookup: publicLookup, request })('https://public.example/start'),
    ).rejects.toThrow(/credentials/i);
  });

  it("propagates the caller's own abort signal", async () => {
    const controller = new AbortController();
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
    const fetchPromise = createMcpSafeFetch({ lookup: publicLookup, request })(
      'https://public.example/mcp',
      { signal: controller.signal },
    );
    controller.abort(new Error('caller cancelled'));
    await expect(fetchPromise).rejects.toThrow(/caller cancelled/);
  });

  it('resolves cleanly for a response with no body (e.g. 204)', async () => {
    const request = response(null, { status: 204 });
    const result = await createMcpSafeFetch({ lookup: publicLookup, request })(
      'https://public.example/mcp',
    );
    expect(result.status).toBe(204);
  });

  it('enforces the body limit while streaming, even without a content-length header', async () => {
    const request = vi.fn<McpPinnedRequest>(async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('x'.repeat(100)));
          controller.close();
        },
      });
      return new Response(body); // no content-length: the declared-size check can't catch this
    });
    const result = await createMcpSafeFetch({
      lookup: publicLookup,
      request,
      limits: { maxBodyBytes: 10 },
    })('https://public.example/mcp');
    await expect(result.text()).rejects.toThrow(/size limit/i);
  });

  it('falls back to an unread body when a header-bounds violation cancel itself fails', async () => {
    const request = vi.fn<McpPinnedRequest>(async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('x'));
        },
        cancel() {
          throw new Error('cancel is not supported by this stream');
        },
      });
      return new Response(body, { headers: { 'x-large': 'x'.repeat(128) } });
    });
    await expect(
      createMcpSafeFetch({
        lookup: publicLookup,
        request,
        limits: { maxHeaderBytes: 64 },
      })('https://public.example/mcp'),
    ).rejects.toThrow(/header/i);
  });

  it('resolves the response as-is when a redirect status carries no Location header', async () => {
    const request = response('', { status: 302 });
    const result = await createMcpSafeFetch({ lookup: publicLookup, request })(
      'https://public.example/mcp',
    );
    expect(result.status).toBe(302);
  });

  it('downgrades a POST to GET on a 302 redirect, dropping the body', async () => {
    let secondInit: RequestInit | undefined;
    const request = vi.fn<McpPinnedRequest>(async (url, init) => {
      if (url.pathname === '/start') {
        return Response.redirect('https://public.example/next', 302);
      }
      secondInit = init;
      return new Response('ok');
    });
    const result = await createMcpSafeFetch({ lookup: publicLookup, request })(
      'https://public.example/start',
      { method: 'POST', body: 'payload' },
    );
    expect(await result.text()).toBe('ok');
    expect(secondInit?.method).toBe('GET');
    expect(secondInit?.body).toBeUndefined();
  });

  it('preserves the method on a 307 redirect (no downgrade)', async () => {
    let secondMethod: string | undefined;
    const request = vi.fn<McpPinnedRequest>(async (url, init) => {
      if (url.pathname === '/start') {
        return Response.redirect('https://public.example/next', 307);
      }
      secondMethod = init.method;
      return new Response('ok');
    });
    await createMcpSafeFetch({ lookup: publicLookup, request })('https://public.example/start', {
      method: 'POST',
      body: 'payload',
    });
    expect(secondMethod).toBe('POST');
  });

  it('strips auth/cookie headers on a cross-origin redirect, but keeps them same-origin', async () => {
    let crossOriginHeaders: Headers | undefined;
    let sameOriginHeaders: Headers | undefined;
    const lookup: McpDnsLookup = async () => [{ address: '93.184.216.34', family: 4 }];
    const request = vi.fn<McpPinnedRequest>(async (url, init) => {
      if (url.hostname === 'a.example' && url.pathname === '/start') {
        return Response.redirect('https://a.example/same-origin', 307);
      }
      if (url.hostname === 'a.example' && url.pathname === '/same-origin') {
        sameOriginHeaders = new Headers(init.headers);
        return Response.redirect('https://b.example/cross-origin', 307);
      }
      crossOriginHeaders = new Headers(init.headers);
      return new Response('ok');
    });
    await createMcpSafeFetch({ lookup, request })('https://a.example/start', {
      headers: { authorization: 'Bearer secret', cookie: 'session=1' },
    });
    expect(sameOriginHeaders?.get('authorization')).toBe('Bearer secret');
    expect(crossOriginHeaders?.has('authorization')).toBe(false);
    expect(crossOriginHeaders?.has('cookie')).toBe(false);
  });
});
