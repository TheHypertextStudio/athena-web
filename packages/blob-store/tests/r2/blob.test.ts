import { describe, expect, it } from 'vitest';

import { type HttpClient } from '../../src/http';
import { R2Blob, signR2Request, type R2Credentials } from '../../src/index';

const CREDS: R2Credentials = {
  accountId: 'acct123',
  accessKeyId: 'AKIAEXAMPLE',
  secretAccessKey: 'secret-example-key',
  bucket: 'studio-artifacts',
};

interface StoredEntry {
  bytes: Uint8Array;
  headers: Record<string, string>;
}

/** In-memory S3/R2 HTTP double exercising signed request parsing, status codes, and byte parity. */
function r2MemoryTransport() {
  const objects = new Map<string, StoredEntry>();
  let forcedStatus: number | undefined;
  let forcedError: Error | undefined;
  const requests: { method: string; url: string; headers: Headers }[] = [];

  async function handleRequest(
    method: string,
    key: string,
    headers: Headers,
    bodyInit: RequestInit['body'],
  ): Promise<Response> {
    if (method === 'PUT') {
      const body = bodyInit
        ? new Uint8Array(await new Response(bodyInit).arrayBuffer())
        : new Uint8Array();
      objects.set(key, { bytes: body, headers: Object.fromEntries(headers.entries()) });
      return new Response(null, { status: 200, headers: { etag: '"gen-1"' } });
    }
    if (method === 'GET') {
      const entry = objects.get(key);
      return entry
        ? new Response(new Uint8Array(entry.bytes), { status: 200 })
        : new Response(null, { status: 404 });
    }
    if (method === 'DELETE') {
      return new Response(null, { status: objects.delete(key) ? 204 : 404 });
    }
    return new Response(null, { status: 405 });
  }

  const http: HttpClient = async (input, init) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers);
    requests.push({ method, url: input, headers });

    if (forcedError) throw forcedError;
    if (forcedStatus) return new Response(null, { status: forcedStatus });

    const key = new URL(input).pathname.replace(/^\/[^/]+\/?/, '');
    return handleRequest(method, key, headers, init?.body);
  };

  return {
    http,
    objects,
    requests,
    failStatus: (status: number) => {
      forcedStatus = status;
    },
    failNetwork: (cause: Error) => {
      forcedError = cause;
    },
  };
}

describe('signR2Request', () => {
  it('produces deterministic AWS SigV4 headers with sorted query parameters', () => {
    const signed = signR2Request(CREDS, {
      method: 'PUT',
      key: '/nested/hello world.txt',
      query: { partNumber: '1', uploadId: 'u-1' },
      headers: { 'Content-Type': 'text/plain' },
      body: new TextEncoder().encode('hi'),
      now: new Date('2026-11-18T10:00:00.000Z'),
    });

    expect(signed.url).toBe(
      'https://acct123.r2.cloudflarestorage.com/studio-artifacts/nested/hello%20world.txt?partNumber=1&uploadId=u-1',
    );
    expect(signed.headers['host']).toBe('acct123.r2.cloudflarestorage.com');
    expect(signed.headers['x-amz-date']).toBe('20261118T100000Z');
    expect(signed.headers['authorization']).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\/20261118\/auto\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
  });

  it('respects a custom endpoint without trailing slash duplication', () => {
    const signed = signR2Request(
      { ...CREDS, endpoint: 'https://r2.local:8787/' },
      { method: 'GET', key: '' },
    );
    expect(signed.url).toBe('https://r2.local:8787/studio-artifacts');
    expect(signed.headers['host']).toBe('r2.local:8787');
  });
});

describe('R2Blob', () => {
  it('retains exact bytes and MIME under the key and replaces the previous value', async () => {
    const transport = r2MemoryTransport();
    const blob = new R2Blob(CREDS, transport.http);

    expect(
      await blob.put('exports/account/a/1.zip', new Uint8Array([0, 255, 2]), 'application/zip'),
    ).toEqual({
      key: 'exports/account/a/1.zip',
      url: 'r2://studio-artifacts/exports/account/a/1.zip',
    });

    expect(await blob.get('exports/account/a/1.zip')).toEqual(new Uint8Array([0, 255, 2]));
    const stored = transport.objects.get('exports/account/a/1.zip');
    expect(stored?.headers['content-type']).toBe('application/zip');
    expect(stored?.headers['cache-control']).toBe('private, no-store');
    expect(stored?.headers['x-amz-meta-crc32c']).toBeDefined();

    await blob.put('exports/account/a/1.zip', new Uint8Array([3]));
    expect(await blob.get('exports/account/a/1.zip')).toEqual(new Uint8Array([3]));
    expect(transport.objects.size).toBe(1);
  });

  it('returns null only for missing objects and supports idempotent deletion', async () => {
    const transport = r2MemoryTransport();
    const blob = new R2Blob(CREDS, transport.http);

    expect(await blob.get('missing')).toBeNull();
    await blob.put('key', new Uint8Array([1]));
    await blob.delete('key');
    await blob.delete('key');
    expect(await blob.get('key')).toBeNull();
  });

  it('preserves provider failures for each operation', async () => {
    const transport = r2MemoryTransport();
    const blob = new R2Blob(CREDS, transport.http);

    transport.failStatus(403);
    await expect(blob.get('secret')).rejects.toThrow('R2Blob get failed for key "secret"');
    await expect(blob.put('secret', new Uint8Array([1]))).rejects.toThrow(
      'R2Blob put failed for key "secret"',
    );
    await expect(blob.delete('secret')).rejects.toThrow('R2Blob delete failed for key "secret"');

    const cause = new Error('network down');
    transport.failNetwork(cause);
    await expect(blob.get('secret')).rejects.toHaveProperty('cause', cause);
  });

  it('normalizes leading slashes consistently across put, get, url, and delete', async () => {
    const transport = r2MemoryTransport();
    const blob = new R2Blob(CREDS, transport.http);

    await blob.put('/nested/image', new Uint8Array([1, 2]));
    expect(await blob.get('nested/image')).toEqual(new Uint8Array([1, 2]));
    expect(blob.url('/nested/image')).toBe('r2://studio-artifacts/nested/image');
    await blob.delete('/nested/image');
    expect(await blob.get('nested/image')).toBeNull();
  });
});
