import { vValidator } from '@hono/valibot-validator';
import { Hono } from 'hono/tiny';
import * as v from 'valibot';

import type { CacheEnv, CacheHonoEnv } from '../../../types';

import { authorize } from '../../../auth';
import { R2Storage } from '../../storage/r2-storage';

/** Maintained Turbo HTTP v8 artifact protocol, authenticated for a registered Studio namespace. */
export const artifactRouter = new Hono<CacheHonoEnv>();

artifactRouter.use('*', authorize);

const getActiveStorage = (env: CacheEnv) => new R2Storage(env.R2_STORE);

const vCoerceNumber = () => v.pipe(v.unknown(), v.transform(Number), v.number());

artifactRouter.post(
  '/',
  vValidator(
    'json',
    v.object({
      hashes: v.array(v.string()),
    }),
  ),
  vValidator('query', v.object({ teamId: v.optional(v.string()), slug: v.optional(v.string()) })),
  (c) => {
    // Turbo does not require batch discovery; individual reads determine cache hits.
    return c.json({});
  },
);

artifactRouter.get('/status', (c) => {
  const status: 'disabled' | 'enabled' | 'over_limit' | 'paused' = 'enabled';
  return c.json({ status }, 200);
});

artifactRouter.put(
  '/:artifactId',
  vValidator(
    'param',
    v.object({ artifactId: v.pipe(v.string(), v.regex(/^[a-zA-Z0-9_-]{1,256}$/)) }),
  ),
  vValidator('query', v.object({ teamId: v.optional(v.string()), slug: v.optional(v.string()) })),
  vValidator(
    'header',
    v.object({
      'content-type': v.literal('application/octet-stream'),
      'content-length': v.optional(vCoerceNumber()),
      'x-artifact-duration': v.optional(vCoerceNumber()),
      'x-artifact-client-ci': v.optional(v.string()),
      'x-artifact-client-interactive': v.optional(
        v.pipe(vCoerceNumber(), v.minValue(0), v.maxValue(1)),
      ),
      'x-artifact-tag': v.pipe(v.string(), v.minLength(1), v.maxLength(256)),
    }),
  ),
  async (c) => {
    const { artifactId } = c.req.valid('param');
    const teamId = c.get('cacheTeam');
    const validatedHeaders = c.req.valid('header');

    const storage = getActiveStorage(c.env);
    const objectKey = `${teamId}/${artifactId}`;

    const storageMetadata = { artifactTag: validatedHeaders['x-artifact-tag'] };
    const body = c.req.raw.body;
    if (!body) return c.json({ error: 'Artifact body required' }, 400);
    await storage.write(objectKey, body, storageMetadata);

    const uploadUrl = new URL(`${artifactId}?teamId=${teamId}`, c.req.raw.url).toString();
    return c.json({ urls: [uploadUrl] }, 202);
  },
);

// Hono router .get() method captures both GET and HEAD requests
artifactRouter.get(
  '/:artifactId',
  vValidator(
    'param',
    v.object({ artifactId: v.pipe(v.string(), v.regex(/^[a-zA-Z0-9_-]{1,256}$/)) }),
  ),
  vValidator('query', v.object({ teamId: v.optional(v.string()), slug: v.optional(v.string()) })),
  vValidator(
    'header',
    v.object({
      'x-artifact-client-ci': v.optional(v.string()),
      'x-artifact-client-interactive': v.optional(
        v.pipe(vCoerceNumber(), v.minValue(0), v.maxValue(1)),
      ),
    }),
  ),
  async (c) => {
    const { artifactId } = c.req.valid('param');
    const teamId = c.get('cacheTeam');
    const storage = getActiveStorage(c.env);
    const objectKey = `${teamId}/${artifactId}`;

    const storedObject = await storage.readWithMetadata(objectKey);
    if (!storedObject.data) return c.json({}, 404);
    const tag = storedObject.metadata.customMetadata['artifactTag'];
    if (!tag) return c.json({}, 404);

    const responseHeaders: Record<string, string> = {
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Type': 'application/octet-stream',
    };
    responseHeaders['x-artifact-tag'] = tag;
    const response = c.body(storedObject.data, 200, responseHeaders);

    return response;
  },
);

artifactRouter.post(
  '/events',
  vValidator(
    'json',
    v.array(
      v.object({
        sessionId: v.string(),
        source: v.union([v.literal('LOCAL'), v.literal('REMOTE')]),
        event: v.union([v.literal('HIT'), v.literal('MISS')]),
        hash: v.string(),
        duration: v.optional(v.number()),
      }),
    ),
  ),
  vValidator('query', v.object({ teamId: v.optional(v.string()), slug: v.optional(v.string()) })),
  vValidator(
    'header',
    v.object({
      'x-artifact-client-ci': v.optional(v.string()),
      'x-artifact-client-interactive': v.optional(
        v.pipe(vCoerceNumber(), v.minValue(0), v.maxValue(1)),
      ),
    }),
  ),
  (c) => {
    // Events are informational and do not affect artifact availability.
    return c.json({});
  },
);
