/** One reviewer abuse boundary shared by REST, auth sessions and MCP credentials. */
import {
  consumeDemoBudget,
  DemoBudgetExceeded,
  type DemoBudgetSubject,
} from '@docket/auth/demo-budget';
import { acquireDemoStream, DEMO_STREAM_LIFETIME_MS } from '@docket/auth/demo-stream-budget';
import type { Context, MiddlewareHandler } from 'hono';
import type { AppEnv } from '../context';
import { CapabilityError, PayloadTooLargeError, RateLimitedError } from '../error';

const MAX_DEMO_BODY_BYTES = 1024 * 1024;

/** Count bulk array items iteratively, so a JSON-RPC batch cannot conceal many operations. */
export function demoOperationUnits(body: unknown): number {
  const pending = [body];
  let units = 1;
  while (pending.length > 0) {
    const value = pending.pop();
    if (Array.isArray(value)) units += value.length;
    if (units > 250) return units;
    for (const item of nestedValues(value)) pending.push(item);
  }
  return units;
}

function nestedValues(value: unknown): unknown[] {
  return value !== null && typeof value === 'object' ? Object.values(value) : [];
}

async function boundedBody(c: Context): Promise<{ bytes: number; units: number }> {
  if (!c.req.raw.body) return { bytes: 0, units: 1 };
  const reader = (c.req.raw.body as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > MAX_DEMO_BODY_BYTES) {
      await reader.cancel();
      throw new PayloadTooLargeError(MAX_DEMO_BODY_BYTES);
    }
    chunks.push(chunk.value);
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const headers = new Headers(c.req.raw.headers);
  headers.delete('content-length');
  c.req.raw = new Request(c.req.raw, { headers, body });
  let units = 1;
  if (headers.get('content-type')?.includes('application/json')) {
    try {
      units = demoOperationUnits(JSON.parse(new TextDecoder().decode(body)));
    } catch {
      /* The route owns malformed JSON responses. */
    }
  }
  return { bytes, units };
}

/** Keep a shared review identity confined to its provisioned account/workspace. */
function assertDemoAccountScope(c: Context): void {
  const path = c.req.path.replace(/\/$/, '');
  if (
    (path === '/v1/orgs' && c.req.method === 'POST') ||
    (/^\/v1\/orgs\/[^/]+$/.test(path) && c.req.method === 'DELETE') ||
    path === '/v1/me/account' ||
    (path.startsWith('/api/auth/') &&
      !path.startsWith('/api/auth/oauth2/') &&
      !['/api/auth/sign-out', '/api/auth/sign-in/demo-link'].includes(path))
  ) {
    throw new CapabilityError();
  }
}

/** Admit verified reviewer requests before buffering bodies, dispatching tools or performing side effects. */
export async function admitDemoRequest(
  c: Context,
  subject: DemoBudgetSubject,
): Promise<string | null> {
  try {
    const demoId = await consumeDemoBudget(subject, [{ kind: 'requests' }]);
    if (!demoId) return null;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      assertDemoAccountScope(c);
      const { bytes, units } = await boundedBody(c);
      await consumeDemoBudget({ demoId }, [
        { kind: 'writes', amount: units },
        { kind: 'bytes', amount: bytes },
      ]);
    }
    if (
      /\/(exports|sync|import|voice)(?:\/|$)/.test(c.req.path) &&
      !['GET', 'HEAD'].includes(c.req.method)
    ) {
      await consumeDemoBudget({ demoId }, [{ kind: 'expensive' }]);
    }
    return demoId;
  } catch (error) {
    if (error instanceof DemoBudgetExceeded) throw new RateLimitedError(error.retryAfter);
    throw error;
  }
}

/** Limit a reviewer stream's lifetime and release its distributed slot on close, abort or cancel. */
export function boundedDemoStream(response: Response, release: () => Promise<void>): Response {
  if (!response.body) {
    void release().catch(() => {
      console.error('Reviewer stream slot cleanup failed; lease will expire.');
    });
    return response;
  }
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  let done = false;
  let timer: ReturnType<typeof setTimeout>;
  const close = async (): Promise<void> => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    try {
      await reader.cancel();
    } finally {
      await release();
    }
  };
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      timer = setTimeout(() => {
        controller.close();
        void close().catch(() => {
          console.error('Reviewer stream cleanup failed; lease will expire.');
        });
      }, DEMO_STREAM_LIFETIME_MS);
    },
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (done) return;
        if (chunk.done) {
          controller.close();
          await close();
        } else controller.enqueue(chunk.value);
      } catch (error) {
        if (!done) {
          controller.error(error);
          await close();
        }
      }
    },
    cancel: close,
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/** Persistent admission across cookie and REST OAuth identities, before root-mounted user routes. */
export const demoAdmissionMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.path === '/mcp') return next();
  const userId = c.get('principal')?.userId ?? c.get('session')?.user.id;
  if (!userId) return next();
  const demoId = await admitDemoRequest(c, { userId });
  if (!demoId) return next();
  return withDemoStreamAdmission(c, next, demoId);
};

async function withDemoStreamAdmission(
  c: Context,
  next: () => Promise<void>,
  demoId: string,
): Promise<void> {
  const isStream =
    /\/(sse|stream)$/.test(c.req.path) ||
    c.req.header('accept')?.includes('text/event-stream') === true;
  let release: (() => Promise<void>) | undefined;
  try {
    if (isStream) release = await acquireDemoStream(demoId);
    await next();
    if (!release) return;
    if (c.res.headers.get('content-type')?.includes('text/event-stream'))
      c.res = boundedDemoStream(c.res, release);
    else await release();
  } catch (error) {
    if (release) await release();
    if (error instanceof DemoBudgetExceeded) throw new RateLimitedError(error.retryAfter);
    throw error;
  }
}
