/** Cache one generated OpenAPI response per API process. */
import type { Input, MiddlewareHandler } from 'hono';

import type { AppEnv } from './context';

interface CachedResponse {
  readonly body: Uint8Array;
  readonly headers: Headers;
  readonly status: number;
  readonly statusText: string;
}

function responseFromCached(value: CachedResponse): Response {
  return new Response(value.body, {
    status: value.status,
    statusText: value.statusText,
    headers: value.headers,
  });
}

/** Cache the first generated response and apply an optional body transform before storage. */
export function cacheOpenapiDocument<Path extends string, RouteInput extends Input>(
  handler: MiddlewareHandler<AppEnv, Path, RouteInput>,
  cacheControl: string,
  transform?: (response: Response) => Promise<Uint8Array>,
): MiddlewareHandler<AppEnv, Path, RouteInput> {
  let cached: CachedResponse | undefined;
  return async (context, next) => {
    if (cached) return responseFromCached(cached);
    const generated = await handler(context, next);
    if (!generated) return generated;
    const headers = new Headers(generated.headers);
    headers.set('cache-control', cacheControl);
    cached = {
      body: transform ? await transform(generated) : new Uint8Array(await generated.arrayBuffer()),
      headers,
      status: generated.status,
      statusText: generated.statusText,
    };
    return responseFromCached(cached);
  };
}
