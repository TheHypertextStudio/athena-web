/**
 * `@docket/api` — validators for finite GET and HEAD representations.
 *
 * Streaming responses bypass this middleware before any body clone or digest. A response
 * classified as `text/event-stream` must reach the client while its body remains open.
 */
import type { MiddlewareHandler } from 'hono';

import type { AppEnv } from '../context';
import { operationContractForRequest } from './api-operation-contract';

const RETAINED_NOT_MODIFIED_HEADERS = [
  'cache-control',
  'content-location',
  'date',
  'docket-revision',
  'docket-version',
  'etag',
  'expires',
  'vary',
  'x-request-id',
] as const;

function isEventStream(response: Response): boolean {
  return (
    (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ===
    'text/event-stream'
  );
}

function stripWeakPrefix(tag: string): string {
  return tag.trim().replace(/^W\//i, '');
}

function weaklyMatches(ifNoneMatch: string | undefined, tag: string): boolean {
  if (ifNoneMatch === undefined) return false;
  return ifNoneMatch
    .split(',')
    .map((candidate) => candidate.trim())
    .some((candidate) => candidate === '*' || stripWeakPrefix(candidate) === stripWeakPrefix(tag));
}

async function responseTag(response: Response): Promise<string | undefined> {
  const existing = response.headers.get('etag');
  if (existing) return existing;
  if (response.body === null || isEventStream(response)) return undefined;
  const bytes = await response.clone().arrayBuffer();
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
  return `"${hex}"`;
}

function notModified(response: Response, tag: string): Response {
  const headers = new Headers();
  for (const name of RETAINED_NOT_MODIFIED_HEADERS) {
    const value = name === 'etag' ? tag : response.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return new Response(null, { status: 304, statusText: 'Not Modified', headers });
}

/**
 * Add a strong representation tag to successful finite reads and honor weak If-None-Match.
 *
 * @remarks
 * A resource revision and a representation validator are different contracts. This middleware
 * hashes the final response bytes, so two caller-specific representations never share a strong
 * tag merely because they describe the same aggregate revision.
 */
export const finiteEtag: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  if ((c.req.method !== 'GET' && c.req.method !== 'HEAD') || c.res.status !== 200) return;
  const contract = operationContractForRequest(c);
  if (contract && !contract.conditionalRead) return;
  if (isEventStream(c.res)) return;

  const tag = c.res.headers.get('ETag') ?? (await responseTag(c.res));
  if (!tag) return;
  if (weaklyMatches(c.req.header('If-None-Match'), tag)) {
    c.res = notModified(c.res, tag);
    return;
  }
  c.res.headers.set('ETag', tag);
};
