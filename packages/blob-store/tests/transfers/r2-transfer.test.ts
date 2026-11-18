import { describe, expect, it } from 'vitest';

import { type HttpClient } from '../../src/http';
import { R2Blob, type R2Credentials } from '../../src/index';

const CREDS: R2Credentials = {
  accountId: 'acct123',
  accessKeyId: 'AKIAEXAMPLE',
  secretAccessKey: 'secret-example-key',
  bucket: 'studio-artifacts',
};

interface R2ObjectRecord {
  bytes: Uint8Array;
  contentType: string;
  crc32c: string;
  etag: string;
}

/** Minimal S3-compatible in-memory R2 server supporting HEAD, GET (with Range), PUT (copy), DELETE. */
function r2Server() {
  const objects = new Map<string, R2ObjectRecord>();
  let nextGen = 1;
  let forceStatus: number | undefined;
  let stripMetadata = false;
  let putCount = 0;

  function handleHead(key: string): Response {
    const record = objects.get(key);
    if (!record) return new Response(null, { status: 404 });
    return new Response(null, {
      status: 200,
      headers: stripMetadata
        ? { 'content-length': 'NaN' }
        : {
            'content-length': String(record.bytes.length),
            'x-amz-meta-crc32c': record.crc32c,
            etag: `"${record.etag}"`,
          },
    });
  }

  async function handlePut(
    key: string,
    headers: Headers,
    bodyInit: RequestInit['body'],
  ): Promise<Response> {
    putCount += 1;
    const copySource = headers.get('x-amz-copy-source');
    if (copySource) {
      if (headers.get('if-none-match') === '*' && objects.has(key))
        return new Response(null, { status: 412 });
      const source = objects.get(decodeURIComponent(copySource.replace(/^\/[^/]+\//, '')));
      if (!source) return new Response(null, { status: 404 });
      objects.set(key, {
        bytes: new Uint8Array(source.bytes),
        contentType: headers.get('content-type') ?? source.contentType,
        crc32c: source.crc32c,
        etag: `gen-${nextGen++}`,
      });
      return new Response(null, { status: 200 });
    }
    const body = bodyInit
      ? new Uint8Array(await new Response(bodyInit).arrayBuffer())
      : new Uint8Array();
    objects.set(key, {
      bytes: body,
      contentType: headers.get('content-type') ?? 'application/octet-stream',
      crc32c: headers.get('x-amz-meta-crc32c') ?? '',
      etag: `gen-${nextGen++}`,
    });
    return new Response(null, { status: 200 });
  }

  function handleGet(key: string, headers: Headers): Response {
    const record = objects.get(key);
    if (!record) return new Response(null, { status: 404 });
    const rangeHeader = headers.get('range');
    if (!rangeHeader) return new Response(new Uint8Array(record.bytes), { status: 200 });
    const match = /^bytes=(\d+)-(\d+)$/.exec(rangeHeader);
    if (!match) return new Response(null, { status: 416 });
    return new Response(
      new Uint8Array(record.bytes.slice(Number(match[1]), Number(match[2]) + 1)),
      {
        status: 206,
      },
    );
  }

  const http: HttpClient = async (input, init) => {
    if (forceStatus) return new Response(null, { status: forceStatus });
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers);
    const key = decodeURIComponent(new URL(input).pathname.replace(/^\/[^/]+\//, ''));
    if (method === 'HEAD') return handleHead(key);
    if (method === 'PUT') return handlePut(key, headers, init?.body);
    if (method === 'GET') return handleGet(key, headers);
    if (method === 'DELETE') return new Response(null, { status: objects.delete(key) ? 204 : 404 });
    return new Response(null, { status: 405 });
  };

  return {
    http,
    objects,
    getPutCount: () => putCount,
    setForceStatus: (status?: number) => {
      forceStatus = status;
    },
    setStripMetadata: (value: boolean) => {
      stripMetadata = value;
    },
  };
}

const bytes = new TextEncoder().encode('123456789');
const options = { byteSize: 9, crc32c: '4waSgw==', contentType: 'text/plain' };

describe('R2 resumable transfer boundary', () => {
  it('publishes a single-chunk upload directly in one PUT without staging a partial object', async () => {
    const server = r2Server();
    const blob = new R2Blob(CREDS, server.http);

    expect(await blob.transfer.begin('single', options)).toBeNull();
    expect(await blob.transfer.append('single', options, 0, bytes)).toEqual({
      offset: 9,
      complete: true,
    });
    expect(server.getPutCount()).toBe(1);
    expect(server.objects.has('single.partial')).toBe(false);
    expect(await blob.get('single')).toEqual(bytes);
    expect(await blob.transfer.stat('single')).toMatchObject({
      byteSize: 9,
      crc32c: '4waSgw==',
    });
  });

  it('recovers an interrupted multi-chunk transfer and validates integrity on completion', async () => {
    const server = r2Server();
    const blob = new R2Blob(CREDS, server.http);

    expect(await blob.transfer.status('file', options, null)).toEqual({
      offset: 0,
      complete: false,
    });
    expect(await blob.transfer.append('file', options, 0, bytes.slice(0, 3))).toEqual({
      offset: 3,
      complete: false,
    });
    expect(await blob.get('file')).toBeNull();
    expect(await blob.transfer.status('file', options, null)).toEqual({
      offset: 3,
      complete: false,
    });

    await expect(blob.transfer.append('file', options, 0, bytes)).rejects.toThrow(
      'Invalid resumable chunk',
    );

    expect(await blob.transfer.append('file', options, 3, bytes.slice(3))).toEqual({
      offset: 9,
      complete: true,
    });
    expect(await blob.transfer.status('file', options, null)).toEqual({
      offset: 9,
      complete: true,
    });
    expect(await blob.get('file')).toEqual(bytes);
    expect(server.objects.has('file.partial')).toBe(false);

    await expect(blob.transfer.append('file', options, 0, bytes)).rejects.toThrow(
      'Invalid resumable chunk',
    );
  });

  it('rejects corrupt single-chunk and multi-chunk uploads without publishing bytes', async () => {
    const server = r2Server();
    const blob = new R2Blob(CREDS, server.http);

    await expect(blob.transfer.append('bad-single', options, 0, new Uint8Array(9))).rejects.toThrow(
      'Upload integrity mismatch',
    );
    expect(await blob.get('bad-single')).toBeNull();

    await blob.transfer.append('bad-multi', options, 0, bytes.slice(0, 4));
    await expect(blob.transfer.append('bad-multi', options, 4, new Uint8Array(5))).rejects.toThrow(
      'Upload integrity mismatch',
    );
    expect(await blob.get('bad-multi')).toBeNull();
    expect(await blob.transfer.status('bad-multi', options, null)).toEqual({
      offset: 0,
      complete: false,
    });

    await blob.transfer.append('canceled', options, 0, bytes.slice(0, 4));
    await blob.transfer.cancel('canceled', null);
    expect(await blob.transfer.status('canceled', options, null)).toEqual({
      offset: 0,
      complete: false,
    });
  });

  it('streams byte ranges and copies objects server-side without clobbering existing keys', async () => {
    const server = r2Server();
    const blob = new R2Blob(CREDS, server.http);

    await blob.put('source', bytes, 'text/plain');
    await blob.transfer.copy('source', 'copy', 'text/plain');
    await blob.delete('source');

    const rangeStream = await blob.transfer.stream('copy', { start: 2, end: 5 });
    expect(await new Response(rangeStream).text()).toBe('3456');
    const fullStream = await blob.transfer.stream('copy');
    expect(await new Response(fullStream).text()).toBe('123456789');
    expect(await blob.transfer.stat('copy')).toMatchObject({ byteSize: 9, crc32c: '4waSgw==' });

    await expect(blob.transfer.copy('copy', 'copy', 'text/plain')).rejects.toThrow(
      'R2Transfer copy failed: 412',
    );
  });

  it('surfaces invalid metadata and HTTP error responses clearly', async () => {
    const server = r2Server();
    const blob = new R2Blob(CREDS, server.http);
    await blob.put('k', bytes, 'text/plain');

    server.setStripMetadata(true);
    await expect(blob.transfer.stat('k')).rejects.toThrow('Invalid object metadata');
    server.setStripMetadata(false);

    server.setForceStatus(503);
    await expect(blob.transfer.stat('k')).rejects.toThrow('R2Transfer stat failed: 503');
    await expect(blob.transfer.stream('k')).rejects.toThrow('R2Transfer stream failed: 503');
    await expect(blob.transfer.cancel('k', null)).rejects.toThrow('R2Transfer delete failed: 503');
    await expect(blob.transfer.append('m', options, 0, bytes)).rejects.toThrow(
      'R2Transfer stat failed: 503',
    );
  });
});
