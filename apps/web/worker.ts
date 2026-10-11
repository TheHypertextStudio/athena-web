// Generated implementation; the source declaration keeps pre-build checks independent of output.
import nativeHandler from './.open-next/worker.js';
import { releaseIdentityResponse } from './release-identity';

export default {
  /** Serve immutable release identity or preserve the native Next response and image policy. */
  async fetch(request: Request, env: Record<string, unknown>, context: unknown): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (pathname === '/__studio/release') {
      return releaseIdentityResponse(env);
    }
    const response: unknown = await nativeHandler.fetch(request, env, context);
    if (!(response instanceof Response)) {
      throw new TypeError('Native OpenNext handler did not return a Response');
    }
    if (pathname === '/_next/image' && response.ok && !response.headers.has('Cache-Control')) {
      // Native OpenNext omits TTL on non-hashed images. Preserve this app's Next default.
      const headers = new Headers(response.headers);
      headers.set('Cache-Control', 'public, max-age=14400, must-revalidate');
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }
    return response;
  },
};

// The native build owns its optional durable-object implementations.
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from './.open-next/worker.js';
