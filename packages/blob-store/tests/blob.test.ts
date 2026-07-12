import { describe, expect, it } from 'vitest';

import type { HttpClient } from '../src/http';
import { RealBlob, type BlobUploadFn } from '../src/vercel';

/** A recorded `@vercel/blob` `put` call: its pathname, body, and options. */
interface RecordedUpload {
  readonly pathname: string;
  readonly body: Uint8Array;
  readonly options: Parameters<BlobUploadFn>[2];
}

/**
 * A fake SDK `put` that records calls and returns a scripted {@link PutBlobResult}-ish
 * value (or throws when `result` is an `Error`).
 */
function fakeUpload(result: { url: string } | Error): {
  upload: BlobUploadFn;
  calls: RecordedUpload[];
} {
  const calls: RecordedUpload[] = [];
  const upload: BlobUploadFn = async (pathname, body, options) => {
    calls.push({ pathname, body, options });
    if (result instanceof Error) throw result;
    // Only the fields RealBlob reads matter; cast the rest of PutBlobResult away.
    return { url: result.url } as Awaited<ReturnType<BlobUploadFn>>;
  };
  return { upload, calls };
}

/** A fake {@link HttpClient} that records read calls and returns a scripted response. */
function fakeHttp(response: Response): {
  http: HttpClient;
  calls: { url: string; init?: RequestInit }[];
} {
  const calls: { url: string; init?: RequestInit }[] = [];
  const http: HttpClient = async (url, init) => {
    calls.push({ url, ...(init ? { init } : {}) });
    return response;
  };
  return { http, calls };
}

describe('RealBlob.put', () => {
  it('uploads via the SDK with deterministic options and returns the SDK url', async () => {
    const { upload, calls } = fakeUpload({ url: 'https://store.example.com/exports/a.txt' });
    const blob = new RealBlob({ baseUrl: 'https://store.example.com/', token: 'tok' }, { upload });
    const data = new TextEncoder().encode('hello');
    const result = await blob.put('exports/a.txt', data);
    expect(result).toEqual({
      key: 'exports/a.txt',
      url: 'https://store.example.com/exports/a.txt',
    });
    const call = calls[0]!;
    expect(call.pathname).toBe('exports/a.txt');
    expect(call.body).toBe(data);
    expect(call.options).toEqual({
      access: 'public',
      token: 'tok',
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  });

  it('strips a leading slash from the key before uploading', async () => {
    const { upload, calls } = fakeUpload({ url: 'https://store.example.com/a.txt' });
    const blob = new RealBlob({ baseUrl: 'https://store.example.com', token: 'tok' }, { upload });
    await blob.put('/a.txt', new Uint8Array([1]));
    expect(calls[0]!.pathname).toBe('a.txt');
  });

  it('forwards an explicit content type to the SDK', async () => {
    const { upload, calls } = fakeUpload({ url: 'https://store.example.com/a.json' });
    const blob = new RealBlob({ baseUrl: 'https://store.example.com', token: 'tok' }, { upload });
    await blob.put('a.json', new Uint8Array([1]), 'application/json');
    expect(calls[0]!.options).toMatchObject({ contentType: 'application/json' });
  });

  it('omits contentType when none is given', async () => {
    const { upload, calls } = fakeUpload({ url: 'https://store.example.com/a.bin' });
    const blob = new RealBlob({ baseUrl: 'https://store.example.com', token: 'tok' }, { upload });
    await blob.put('a.bin', new Uint8Array([1]));
    expect(calls[0]!.options).not.toHaveProperty('contentType');
  });

  it('falls back to the constructed url when the SDK returns no url', async () => {
    const { upload } = fakeUpload({ url: '' });
    const blob = new RealBlob({ baseUrl: 'https://store.example.com', token: 'tok' }, { upload });
    const result = await blob.put('nested/key.txt', new Uint8Array([1]));
    expect(result.url).toBe('https://store.example.com/nested/key.txt');
  });

  it('wraps an SDK failure in a clear, key-scoped error that preserves the cause', async () => {
    const cause = new Error('blob service unavailable');
    const { upload } = fakeUpload(cause);
    const blob = new RealBlob({ baseUrl: 'https://store.example.com', token: 'tok' }, { upload });
    await expect(blob.put('exports/a.txt', new Uint8Array([1]))).rejects.toThrow(
      /RealBlob put failed for key "exports\/a.txt"/,
    );
    await expect(blob.put('exports/a.txt', new Uint8Array([1]))).rejects.toHaveProperty(
      'cause',
      cause,
    );
  });
});

describe('RealBlob.get', () => {
  it('reads bytes from the public url with a bearer token', async () => {
    const { http, calls } = fakeHttp(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const blob = new RealBlob({ baseUrl: 'https://store.example.com', token: 'tok' }, { http });
    const got = await blob.get('a.bin');
    expect(got && Array.from(got)).toEqual([1, 2, 3]);
    const call = calls[0]!;
    expect(call.url).toBe('https://store.example.com/a.bin');
    expect((call.init?.headers as Record<string, string>)['Authorization']).toBe('Bearer tok');
  });

  it('returns null for a 404', async () => {
    const { http } = fakeHttp(new Response('missing', { status: 404 }));
    const blob = new RealBlob({ baseUrl: 'https://store.example.com', token: 'tok' }, { http });
    expect(await blob.get('missing.txt')).toBeNull();
  });

  it('throws on a non-404 error status', async () => {
    const { http } = fakeHttp(new Response('err', { status: 500 }));
    const blob = new RealBlob({ baseUrl: 'https://store.example.com', token: 'tok' }, { http });
    await expect(blob.get('a.txt')).rejects.toThrow(/RealBlob get failed: 500/);
  });
});

describe('RealBlob.url', () => {
  it('derives the public store origin from a standard read-write token', () => {
    const blob = new RealBlob({ token: 'vercel_blob_rw_store123_secret' });
    expect(blob.url('exports/a.zip')).toBe(
      'https://store123.public.blob.vercel-storage.com/exports/a.zip',
    );
  });

  it('rejects a token without an encoded store id when no base URL is provided', () => {
    expect(() => new RealBlob({ token: 'invalid' })).toThrow(
      'Invalid BLOB_READ_WRITE_TOKEN: store id is missing.',
    );
  });

  it('addresses a key, trimming trailing base slashes and a leading key slash', () => {
    const blob = new RealBlob({ baseUrl: 'https://store.example.com///', token: 'tok' });
    expect(blob.url('/nested/key.txt')).toBe('https://store.example.com/nested/key.txt');
  });

  it('accepts a bare HttpClient as the second positional arg (parity with other adapters)', () => {
    const http: HttpClient = async () => new Response(null, { status: 200 });
    const blob = new RealBlob({ baseUrl: 'https://store.example.com', token: 'tok' }, http);
    expect(blob.url('a.txt')).toBe('https://store.example.com/a.txt');
  });
});
