/** Hardened outbound HTTP boundary for remote MCP transports and OAuth metadata. */
import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';

import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';

/** One address returned by DNS resolution. */
export interface McpLookupAddress {
  /** Text IP address. */
  readonly address: string;
  /** Address family. */
  readonly family: 4 | 6;
}

/** DNS resolver used by the MCP network boundary. */
export type McpDnsLookup = (hostname: string) => Promise<readonly McpLookupAddress[]>;

/** Low-level HTTPS request pinned to an already validated address. */
export type McpPinnedRequest = (
  url: URL,
  init: RequestInit,
  address: string,
  signal: AbortSignal,
  limits: Readonly<Required<McpNetworkLimits>>,
) => Promise<Response>;

/** Resource bounds applied to each remote MCP request. */
export interface McpNetworkLimits {
  /** Maximum manual redirect hops. */
  readonly maxRedirects?: number;
  /** Maximum time to establish TLS. */
  readonly connectTimeoutMs?: number;
  /** Maximum total time for a request, including redirects and body consumption. */
  readonly overallTimeoutMs?: number;
  /** Maximum serialized response-header bytes. */
  readonly maxHeaderBytes?: number;
  /** Maximum response body bytes. */
  readonly maxBodyBytes?: number;
}

const DEFAULT_LIMITS: Required<McpNetworkLimits> = {
  maxRedirects: 3,
  connectTimeoutMs: 5_000,
  overallTimeoutMs: 30_000,
  maxHeaderBytes: 32 * 1024,
  maxBodyBytes: 2 * 1024 * 1024,
};

const defaultLookup: McpDnsLookup = async (hostname) => {
  const rows = await dns.lookup(hostname, { all: true, verbatim: true });
  return rows.map((row) => ({ address: row.address, family: row.family as 4 | 6 }));
};

function parseIpv4(address: string): readonly [number, number, number, number] | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  const values = parts.map((part) => (/^\d+$/.test(part) ? Number(part) : Number.NaN));
  if (!values.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) return null;
  return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 0];
}

function ipv4Number(address: string): number | null {
  const octets = parseIpv4(address);
  if (!octets) return null;
  return (((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3]) >>> 0;
}

function inIpv4Cidr(value: number, base: number, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffff_ffff << (32 - prefix)) >>> 0;
  return (value & mask) >>> 0 === (base & mask) >>> 0;
}

const BLOCKED_IPV4: readonly (readonly [number, number])[] = [
  [0x0000_0000, 8],
  [0x0a00_0000, 8],
  [0x6440_0000, 10],
  [0x7f00_0000, 8],
  [0xa9fe_0000, 16],
  [0xac10_0000, 12],
  [0xc000_0000, 24],
  [0xc000_0200, 24],
  [0xc058_6300, 24],
  [0xc0a8_0000, 16],
  [0xc612_0000, 15],
  [0xc633_6400, 24],
  [0xcb00_7100, 24],
  [0xe000_0000, 4],
  [0xf000_0000, 4],
];

function parseIpv6(address: string): Uint8Array | null {
  const zoneIndex = address.indexOf('%');
  const value = (zoneIndex >= 0 ? address.slice(0, zoneIndex) : address).toLowerCase();
  const halves = value.split('::');
  if (halves.length > 2) return null;
  const parseHalf = (part: string): number[] | null => {
    if (!part) return [];
    const words: number[] = [];
    for (const token of part.split(':')) {
      if (token.includes('.')) {
        const ipv4 = parseIpv4(token);
        if (!ipv4) return null;
        words.push((ipv4[0] << 8) | ipv4[1], (ipv4[2] << 8) | ipv4[3]);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(token)) return null;
        words.push(Number.parseInt(token, 16));
      }
    }
    return words;
  };
  const left = parseHalf(halves[0] ?? '');
  const right = parseHalf(halves[1] ?? '');
  if (!left || !right) return null;
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const words = [...left, ...Array.from({ length: missing }, () => 0), ...right];
  if (words.length !== 8) return null;
  const bytes = new Uint8Array(16);
  words.forEach((word, index) => {
    bytes[index * 2] = word >> 8;
    bytes[index * 2 + 1] = word & 0xff;
  });
  return bytes;
}

function isPublicIpv4(address: string): boolean {
  const value = ipv4Number(address);
  return value !== null && !BLOCKED_IPV4.some(([base, prefix]) => inIpv4Cidr(value, base, prefix));
}

function isPublicIpv6(address: string): boolean {
  const bytes = parseIpv6(address);
  if (!bytes) return false;
  const mapped =
    bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  if (mapped) return isPublicIpv4(`${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`);
  // Globally routable unicast currently occupies 2000::/3. Exclude documentation space.
  const globalUnicast = ((bytes[0] ?? 0) & 0xe0) === 0x20;
  const ietfReserved = bytes[0] === 0x20 && bytes[1] === 0x01 && ((bytes[2] ?? 0) & 0xfe) === 0;
  const documentation =
    bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8;
  const expandedDocumentation =
    bytes[0] === 0x3f && bytes[1] === 0xff && ((bytes[2] ?? 0) & 0xf0) === 0;
  return globalUnicast && !ietfReserved && !documentation && !expandedDocumentation;
}

function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? isPublicIpv4(address) : family === 6 ? isPublicIpv6(address) : false;
}

async function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  const abortError = (): Error =>
    signal.reason instanceof Error ? signal.reason : new Error('MCP request aborted');
  if (signal.aborted) throw abortError();
  return await new Promise<T>((resolve, reject) => {
    const abort = () => {
      reject(abortError());
    };
    signal.addEventListener('abort', abort, { once: true });
    operation.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', abort);
    });
  });
}

async function resolvePublicAddress(
  url: URL,
  lookup: McpDnsLookup,
  signal: AbortSignal,
): Promise<string> {
  const literalFamily = isIP(url.hostname.replace(/^\[|\]$/g, ''));
  const addresses = literalFamily
    ? [{ address: url.hostname.replace(/^\[|\]$/g, ''), family: literalFamily as 4 | 6 }]
    : await abortable(lookup(url.hostname), signal);
  if (addresses.length === 0) throw new Error('MCP endpoint DNS returned no addresses');
  const blocked = addresses.find((row) => !isPublicAddress(row.address));
  if (blocked) throw new Error(`MCP endpoint address is not public: ${blocked.address}`);
  return addresses[0]?.address ?? '';
}

function boundedBody(
  response: Response,
  maxBodyBytes: number,
  deadlineAt: number,
  controller: AbortController,
): Response {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBodyBytes) {
    const error = new Error('MCP response body exceeds the size limit');
    controller.abort(error);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(error);
      },
    });
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }
  if (!response.body) return response;
  let received = 0;
  const timer = setTimeout(
    () => {
      controller.abort(new Error('MCP request timed out'));
    },
    Math.max(1, deadlineAt - Date.now()),
  );
  const bounded = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > maxBodyBytes) throw new Error('MCP response body exceeds the size limit');
        controller.enqueue(chunk);
      },
      flush() {
        clearTimeout(timer);
      },
    }),
  );
  return new Response(bounded, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function assertHeaderBounds(response: Response, maxHeaderBytes: number): void {
  let bytes = 0;
  response.headers.forEach((value, name) => {
    bytes += Buffer.byteLength(name) + Buffer.byteLength(value) + 4;
  });
  if (bytes > maxHeaderBytes) throw new Error('MCP response headers exceed the size limit');
}

const defaultRequest: McpPinnedRequest = async (url, init, address, signal, limits) => {
  const headers = new Headers(init.headers);
  const body =
    init.body === undefined || init.body === null
      ? null
      : new Uint8Array(await new Request(url, init).arrayBuffer());
  return await new Promise<Response>((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        method: init.method,
        headers: Object.fromEntries(headers.entries()),
        signal,
        maxHeaderSize: limits.maxHeaderBytes,
        servername: url.hostname,
        lookup: (_hostname, _options, callback) => {
          callback(null, address, isIP(address));
        },
      },
      (incoming) => {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (Array.isArray(value))
            value.forEach((item) => {
              responseHeaders.append(name, item);
            });
          else if (value !== undefined) responseHeaders.set(name, value);
        }
        resolve(
          new Response(Readable.toWeb(incoming) as ReadableStream<Uint8Array>, {
            status: incoming.statusCode ?? 500,
            statusText: incoming.statusMessage,
            headers: responseHeaders,
          }),
        );
      },
    );
    request.once('socket', (socket) => {
      const timer = setTimeout(() => {
        request.destroy(new Error('MCP connection timed out'));
      }, limits.connectTimeoutMs);
      socket.once('secureConnect', () => {
        clearTimeout(timer);
      });
      request.once('close', () => {
        clearTimeout(timer);
      });
    });
    request.once('error', reject);
    if (body) request.write(body);
    request.end();
  });
};

/**
 * Create the only fetch implementation permitted for real remote MCP traffic.
 *
 * @remarks
 * Production is HTTPS-only. Tests may inject DNS and transport dependencies at construction time;
 * endpoint requests never carry an allowlist or policy bypass.
 */
export function createMcpSafeFetch(
  options: {
    readonly lookup?: McpDnsLookup;
    readonly request?: McpPinnedRequest;
    readonly limits?: McpNetworkLimits;
  } = {},
): FetchLike {
  const lookup = options.lookup ?? defaultLookup;
  const request = options.request ?? defaultRequest;
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  return async (input, init = {}) => {
    const original = new Request(input, init);
    const controller = new AbortController();
    const deadlineAt = Date.now() + limits.overallTimeoutMs;
    const timeout = setTimeout(() => {
      controller.abort(new Error('MCP request timed out'));
    }, limits.overallTimeoutMs);
    const abort = () => {
      controller.abort(original.signal.reason);
    };
    original.signal.addEventListener('abort', abort, { once: true });
    try {
      let url = new URL(original.url);
      const requestBody = original.body ? new Uint8Array(await original.arrayBuffer()) : undefined;
      let requestInit: RequestInit = {
        method: original.method,
        headers: original.headers,
        ...(requestBody ? { body: requestBody } : {}),
        redirect: 'manual',
      };
      for (let redirects = 0; ; redirects += 1) {
        if (url.protocol !== 'https:') throw new Error('Remote MCP endpoints require HTTPS');
        if (url.username || url.password)
          throw new Error('Remote MCP endpoint credentials are not allowed in URLs');
        const address = await resolvePublicAddress(url, lookup, controller.signal);
        const response = await request(url, requestInit, address, controller.signal, limits);
        try {
          assertHeaderBounds(response, limits.maxHeaderBytes);
        } catch (cause) {
          const error = cause instanceof Error ? cause : new Error('Invalid MCP response headers');
          controller.abort(error);
          await response.body?.cancel(error).catch(() => undefined);
          throw error;
        }
        if (![301, 302, 303, 307, 308].includes(response.status)) {
          return boundedBody(response, limits.maxBodyBytes, deadlineAt, controller);
        }
        const location = response.headers.get('location');
        if (!location) return boundedBody(response, limits.maxBodyBytes, deadlineAt, controller);
        await response.body?.cancel();
        if (redirects >= limits.maxRedirects) throw new Error('Remote MCP redirect limit exceeded');
        const next = new URL(location, url);
        const headers = new Headers(requestInit.headers);
        if (next.origin !== url.origin) {
          headers.delete('authorization');
          headers.delete('cookie');
          headers.delete('proxy-authorization');
        }
        if (
          [301, 302, 303].includes(response.status) &&
          requestInit.method !== 'GET' &&
          requestInit.method !== 'HEAD'
        ) {
          requestInit = { method: 'GET', headers, redirect: 'manual' };
        } else {
          requestInit = { ...requestInit, headers };
        }
        url = next;
      }
    } finally {
      clearTimeout(timeout);
      original.signal.removeEventListener('abort', abort);
    }
  };
}

/** Singleton production policy shared by MCP transport and OAuth protocol traffic. */
export const mcpSafeFetch = createMcpSafeFetch();
