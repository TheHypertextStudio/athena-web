import { Hono } from 'hono/tiny';
import { HTTPException } from 'hono/http-exception';
import { artifactRouter } from './upstream/routes/v8/artifacts';
import type { CacheEnv } from './types';

const app = new Hono<{ Bindings: CacheEnv }>();
app.get('/ping', (c) => c.text('pong'));
app.route('/v8/artifacts', artifactRouter);
app.onError((error, c) => {
  if (error instanceof HTTPException) return error.getResponse();
  console.error(JSON.stringify({ event: 'cache_storage_failure', error: error.name }));
  return c.json({ error: 'Cache temporarily unavailable' }, 503);
});

/** Serve the maintained Turbo protocol directly from a private R2 binding. */
export default {
  fetch(request: Request, env: CacheEnv, ctx: ExecutionContext): Response | Promise<Response> {
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<CacheEnv>;
