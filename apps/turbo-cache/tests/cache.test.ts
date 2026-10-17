import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import type { CacheEnv } from '../src/types';
import { R2Storage } from '../src/upstream/storage/r2-storage';

const audience = 'https://turbo-cache.hypertext.studio';
const issuer = 'https://accounts.google.com';
const subject = '104950679521072783940';
const clients = [
  { subject, namespace: 'docket' },
  { subject: '111111111111111111111', namespace: 'curfew-web' },
  { subject: '222222222222222222222', namespace: 'logdate-web' },
  { subject: '333333333333333333333', namespace: 'studio-product-admin' },
];
const testBindings = {
  ...env,
  CACHE_CLIENTS: JSON.stringify(
    Object.fromEntries(clients.map((client) => [client.subject, client.namespace])),
  ),
};
let signingKey: CryptoKey;
let unrelatedKey: CryptoKey;

beforeAll(async () => {
  const keys = await generateKeyPair('RS256', { extractable: true });
  signingKey = keys.privateKey;
  unrelatedKey = (await generateKeyPair('RS256')).privateKey;
  const publicKey = await exportJWK(keys.publicKey);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== 'https://www.googleapis.com/oauth2/v3/certs')
      throw new Error('Unexpected external request');
    return new Response(
      JSON.stringify({ keys: [{ ...publicKey, kid: 'test-key', alg: 'RS256', use: 'sig' }] }),
      {
        headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' },
      },
    );
  });
});
afterAll(() => vi.restoreAllMocks());

async function token(claims: Record<string, unknown> = {}, key = signingKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    iss: issuer,
    aud: audience,
    sub: subject,
    iat: now,
    exp: now + 3600,
    ...claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .sign(key);
}

async function call(
  path: string,
  options: RequestInit = {},
  bearer?: string,
  bindings: CacheEnv = testBindings,
): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${bearer ?? (await token())}`);
  const context = createExecutionContext();
  const response = await worker.fetch(
    new Request(audience + path, { ...options, headers }),
    bindings,
    context,
  );
  await waitOnExecutionContext(context);
  return response;
}

const artifact = (name = 'abcdef123456') => `/v8/artifacts/${name}?teamId=docket`;
const upload = (body = 'signed archive') => ({
  method: 'PUT',
  body,
  headers: {
    'content-type': 'application/octet-stream',
    'x-artifact-tag': 'opaque-client-hmac',
  },
});

describe('Google workload identity authentication', () => {
  it('provides a public liveness probe and no administrative endpoints', async () => {
    expect(await (await call('/ping')).text()).toBe('pong');
    expect((await call('/internal/delete-expired-objects', { method: 'POST' })).status).toBe(404);
    expect((await call('/throw-exception')).status).toBe(404);
    expect(
      (
        await call('/v8/artifacts/?teamId=docket', {
          method: 'POST',
          body: '{',
          headers: { 'content-type': 'application/json' },
        })
      ).status,
    ).toBe(400);
  });

  it('rejects missing authorization without touching storage', async () => {
    const context = createExecutionContext();
    expect((await worker.fetch(new Request(audience + artifact()), env, context)).status).toBe(401);
    await waitOnExecutionContext(context);
  });

  it.each([
    ['issuer', { iss: 'https://attacker.example' }],
    ['audience', { aud: 'https://another-worker.example' }],
    ['subject', { sub: 'another-service-account' }],
    ['expired', { iat: 1, exp: 2 }],
    ['future issue', { iat: Math.floor(Date.now() / 1000) + 300 }],
    ['missing expiry', { exp: undefined }],
    ['missing issue time', { iat: undefined }],
  ])('rejects invalid %s claims with real JWT verification', async (_name, claims) => {
    const response = await call(artifact(), {}, await token(claims));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
  });

  it('rejects a signature from an unrelated RSA key', async () => {
    expect((await call(artifact(), {}, await token({}, unrelatedKey))).status).toBe(401);
  });

  it('rejects an HMAC token even with otherwise correct claims', async () => {
    const now = Math.floor(Date.now() / 1000);
    const jwt = await new SignJWT({
      iss: issuer,
      aud: audience,
      sub: subject,
      iat: now,
      exp: now + 3600,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .sign(new Uint8Array(32));
    expect((await call(artifact(), {}, jwt)).status).toBe(401);
  });

  it.each([
    '?teamId=other',
    '',
    '?teamId=docket&slug=other',
    '?teamId=docket&teamId=other',
    '?slug=docket&slug=other',
  ])('rejects a mismatched or ambiguous team namespace %s', async (query) => {
    expect((await call('/v8/artifacts/status' + query)).status).toBe(403);
  });

  it('accepts the exact configured subject/audience and slug namespace', async () => {
    const response = await call('/v8/artifacts/status?slug=docket');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'enabled' });
  });
});

describe('repository identity and namespace isolation', () => {
  it('accepts a second registered Google subject only in its own namespace', async () => {
    const response = await call(
      '/v8/artifacts/status?teamId=curfew-web',
      {},
      await token({ sub: clients[1]?.subject }),
    );
    expect(response.status).toBe(200);
  });

  it.each(clients)('accepts $namespace identity only for its own namespace', async (client) => {
    const response = await call(
      `/v8/artifacts/status?teamId=${client.namespace}`,
      {},
      await token({ sub: client.subject }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'enabled' });
  });

  const crossClients = clients.flatMap((source) =>
    clients
      .filter((target) => target.subject !== source.subject)
      .map((target) => ({ source, target })),
  );
  it.each(crossClients)(
    '$source.namespace cannot GET or PUT $target.namespace artifacts',
    async ({ source, target }) => {
      const key = `${target.namespace}/isolated-hash`;
      await env.R2_STORE.put(key, 'target-original', {
        customMetadata: { artifactTag: 'target-tag' },
      });
      const read = vi.spyOn(R2Storage.prototype, 'readWithMetadata');
      const write = vi.spyOn(R2Storage.prototype, 'write');
      try {
        const credential = await token({ sub: source.subject });
        const path = `/v8/artifacts/isolated-hash?teamId=${target.namespace}`;
        expect((await call(path, {}, credential)).status).toBe(403);
        expect((await call(path, upload('cross-client-overwrite'), credential)).status).toBe(403);
        expect(read).not.toHaveBeenCalled();
        expect(write).not.toHaveBeenCalled();
        const retained = await env.R2_STORE.get(key);
        expect(await retained?.text()).toBe('target-original');
        expect(retained?.customMetadata?.['artifactTag']).toBe('target-tag');
      } finally {
        read.mockRestore();
        write.mockRestore();
      }
    },
  );

  it('stores identical artifact hashes with distinct bytes and tags for every namespace', async () => {
    for (const client of clients) {
      const credential = await token({ sub: client.subject });
      const path = `/v8/artifacts/shared-hash?teamId=${client.namespace}`;
      const bytes = `${client.namespace} private artifact`;
      const tag = `${client.namespace}-tag`;
      expect(
        (
          await call(
            path,
            {
              method: 'PUT',
              body: bytes,
              headers: {
                'content-type': 'application/octet-stream',
                'x-artifact-tag': tag,
              },
            },
            credential,
          )
        ).status,
      ).toBe(202);
    }
    for (const client of clients) {
      const credential = await token({ sub: client.subject });
      const response = await call(
        `/v8/artifacts/shared-hash?teamId=${client.namespace}`,
        {},
        credential,
      );
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(`${client.namespace} private artifact`);
      expect(response.headers.get('x-artifact-tag')).toBe(`${client.namespace}-tag`);
      const stored = await env.R2_STORE.get(`${client.namespace}/shared-hash`);
      expect(await stored?.text()).toBe(`${client.namespace} private artifact`);
    }
  });

  it('uses request-local identity context without mutating frozen shared bindings', async () => {
    const frozen = Object.freeze({ ...testBindings });
    const originalKeys = Object.keys(frozen);
    const responses = await Promise.all(
      clients.map(async (client) =>
        call(
          `/v8/artifacts/status?teamId=${client.namespace}`,
          {},
          await token({ sub: client.subject }),
          frozen,
        ),
      ),
    );
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200]);
    expect(Object.keys(frozen)).toEqual(originalKeys);
    expect(Object.hasOwn(frozen, 'cacheTeam')).toBe(false);
  });

  it('rejects an unknown or non-string verified subject with no storage access', async () => {
    const read = vi.spyOn(R2Storage.prototype, 'readWithMetadata');
    try {
      for (const sub of ['444444444444444444444', [subject]]) {
        expect((await call(artifact(), {}, await token({ sub }))).status).toBe(401);
      }
      expect(read).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
    }
  });

  it.each(['{}', '[]', 'null', 'invalid-json', '{"123":"docket","456":"docket"}'])(
    'fails closed for invalid runtime identity mapping %s',
    async (serialized) => {
      expect(
        (await call(artifact(), {}, await token(), { ...env, CACHE_CLIENTS: serialized })).status,
      ).toBe(401);
    },
  );
});

describe('signed Turbo HTTP v8 artifacts', () => {
  it('writes exact team key, bytes and opaque signature metadata to real R2', async () => {
    const response = await call(artifact(), upload());
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ urls: [audience + artifact()] });
    const stored = await env.R2_STORE.get('docket/abcdef123456');
    expect(await stored?.text()).toBe('signed archive');
    expect(stored?.customMetadata?.['artifactTag']).toBe('opaque-client-hmac');
  });

  it('returns exact bytes and signature without intermediary cache headers', async () => {
    await call(artifact('read-hash'), upload('retained cache bytes'));
    const response = await call(artifact('read-hash'));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('retained cache bytes');
    expect(response.headers.get('x-artifact-tag')).toBe('opaque-client-hmac');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('supports HEAD metadata without returning the artifact body', async () => {
    await call(artifact('head-hash'), upload());
    const response = await call(artifact('head-hash'), { method: 'HEAD' });
    expect(response.status).toBe(200);
    expect(response.headers.get('x-artifact-tag')).toBe('opaque-client-hmac');
    expect(await response.text()).toBe('');
  });

  it('returns misses for missing artifacts and unsigned stored objects', async () => {
    expect((await call(artifact('missing-hash'))).status).toBe(404);
    await env.R2_STORE.put('docket/unsigned-hash', 'unsigned bytes');
    expect((await call(artifact('unsigned-hash'))).status).toBe(404);
  });

  it('rejects unsigned uploads and invalid artifact path keys', async () => {
    expect(
      (
        await call(artifact('unsigned-put'), {
          method: 'PUT',
          body: 'data',
          headers: {
            'content-type': 'application/octet-stream',
          },
        })
      ).status,
    ).toBe(400);
    expect((await call('/v8/artifacts/nested%2Fhash?teamId=docket', upload())).status).toBe(400);
    expect((await call(artifact('bad.type'), upload())).status).toBe(400);
    expect(
      (
        await call(artifact('wrong-content'), {
          ...upload(),
          headers: { 'content-type': 'text/plain', 'x-artifact-tag': 'tag' },
        })
      ).status,
    ).toBe(400);
    expect(await env.R2_STORE.get('docket/unsigned-put')).toBeNull();
  });

  it('retains upstream batch-discovery and event compatibility', async () => {
    expect(
      (
        await call('/v8/artifacts/?teamId=docket', {
          method: 'POST',
          body: JSON.stringify({ hashes: ['abc'] }),
          headers: { 'content-type': 'application/json' },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call('/v8/artifacts/events?teamId=docket', {
          method: 'POST',
          body: JSON.stringify([{ sessionId: 'run', source: 'REMOTE', event: 'HIT', hash: 'abc' }]),
          headers: { 'content-type': 'application/json' },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call('/v8/artifacts/events?teamId=docket', {
          method: 'POST',
          body: '{}',
          headers: { 'content-type': 'application/json' },
        })
      ).status,
    ).toBe(400);
  });

  it('streams an upload and a download without reading either whole body in Worker code', async () => {
    const chunk = new Uint8Array(256 * 1024).fill(23);
    const { readable, writable } = new FixedLengthStream(chunk.byteLength * 8);
    const writing = (async () => {
      const writer = writable.getWriter();
      for (let index = 0; index < 8; index++) await writer.write(chunk);
      await writer.close();
    })();
    const response = await call(artifact('stream-hash'), {
      method: 'PUT',
      body: readable,
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(chunk.byteLength * 8),
        'x-artifact-tag': 'stream-tag',
      },
    });
    await writing;
    expect(response.status).toBe(202);
    const download = await call(artifact('stream-hash'));
    const body = download.body;
    expect(body).not.toBeNull();
    if (!body) throw new Error('Missing response stream');
    const reader = body.getReader();
    let count = 0;
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      const bytes: unknown = next.value;
      if (!(bytes instanceof Uint8Array)) throw new Error('Unexpected stream chunk');
      expect(bytes.every((byte) => byte === 23)).toBe(true);
      count += bytes.byteLength;
    }
    expect(count).toBe(chunk.byteLength * 8);
  });

  it('rejects an absent artifact body before R2 writes', async () => {
    const response = await call(artifact('empty-body'), {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream', 'x-artifact-tag': 'tag' },
    });
    expect(response.status).toBe(400);
  });

  it('returns a generic retryable provider failure without storage details', async () => {
    const read = vi
      .spyOn(R2Storage.prototype, 'readWithMetadata')
      .mockRejectedValueOnce(new Error('private provider detail'));
    const logging = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await call(artifact('failure-hash'));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Cache temporarily unavailable' });
    read.mockRestore();
    logging.mockRestore();
  });
});

describe('upstream R2 adapter', () => {
  it('lists, streams, preserves metadata and deletes through a real private R2 binding', async () => {
    const storage = new R2Storage(env.R2_STORE);
    await storage.write('adapter/a', 'first', { artifactTag: 'first-tag' });
    await storage.write('adapter/b', 'second');
    const firstPage = await storage.list({ prefix: 'adapter/', limit: 1 });
    expect(firstPage.keys).toEqual(['adapter/a']);
    expect(firstPage.truncated).toBe(true);
    expect((await storage.list({ prefix: 'adapter/', cursor: firstPage.cursor })).keys).toEqual([
      'adapter/b',
    ]);
    const metadata = await storage.listWithMetadata({ prefix: 'adapter/' });
    expect(metadata.keys[0]?.metadata.customMetadata).toEqual({ artifactTag: 'first-tag' });
    expect(await new Response(await storage.read('adapter/a')).text()).toBe('first');
    expect(await storage.read('not-present')).toBeUndefined();
    await storage.delete(['adapter/a', 'adapter/b']);
    expect((await storage.list()).keys).not.toContain('adapter/a');
    expect((await storage.listWithMetadata()).truncated).toBe(false);
  });
});
