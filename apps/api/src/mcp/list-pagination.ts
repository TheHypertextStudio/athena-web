/**
 * `@docket/api` -- opaque cursor pagination for MCP list operations.
 */
import { createHmac } from 'node:crypto';

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import type { McpContext } from './auth';
import { createCursorCodec } from './cursors';

const CURSOR_VERSION = 1;

/** The MCP catalog surface a cursor and page belong to. */
export type ListSurface = 'tools' | 'resources' | 'resourceTemplates' | 'prompts';

/**
 * A keyed catalog item to paginate over.
 *
 * @typeParam Value - The item value emitted in a page.
 */
export interface CatalogEntry<Value> {
  /** Stable sort/pagination key uniquely identifying the entry. */
  readonly key: string;
  /** The value returned to clients for this entry. */
  readonly value: Value;
}

interface CursorPayload {
  readonly v: typeof CURSOR_VERSION;
  readonly surface: ListSurface;
  readonly subject: string;
  readonly key: string;
}

const CursorPayloadSchema: z.ZodType<CursorPayload> = z.object({
  v: z.literal(CURSOR_VERSION),
  surface: z.enum(['tools', 'resources', 'resourceTemplates', 'prompts']),
  subject: z.string(),
  key: z.string(),
});

const cursorCodec = createCursorCodec({
  payloadSchema: CursorPayloadSchema,
  invalidCursorError: invalidCursor,
  secretMissingError: () =>
    new McpError(ErrorCode.InternalError, 'MCP signing secret is not configured'),
});

function invalidCursor(): McpError {
  return new McpError(ErrorCode.InvalidParams, 'Invalid cursor');
}

function signingSecret(): string {
  const secret = process.env['BETTER_AUTH_SECRET'];
  if (!secret) throw new McpError(ErrorCode.InternalError, 'MCP signing secret is not configured');
  return secret;
}

function subjectFor(ctx: McpContext): string {
  return createHmac('sha256', signingSecret()).update(ctx.userId).digest('base64url').slice(0, 32);
}

function decodeCursor(
  cursor: string | undefined,
  surface: ListSurface,
  subject: string,
): string | undefined {
  if (!cursor) return undefined;
  const payload = cursorCodec.decode(cursor);
  if (payload.surface !== surface || payload.subject !== subject) throw invalidCursor();
  return payload.key;
}

/**
 * Return a single page of catalog values plus a signed cursor for the next page.
 *
 * @typeParam Value - The item value emitted in a page.
 * @param entries - The full, ordered set of catalog entries.
 * @param cursor - The opaque cursor from a prior page, or undefined for the first.
 * @param surface - The catalog surface being paginated; bound into the cursor.
 * @param ctx - The MCP request context used to scope the cursor to the caller.
 * @param pageSize - The maximum number of items to return.
 * @returns The page's items and an optional `nextCursor` when more remain.
 * @throws {McpError} When the cursor is invalid or no longer resolves to an entry.
 */
export function pageValues<Value>(
  entries: readonly CatalogEntry<Value>[],
  cursor: string | undefined,
  surface: ListSurface,
  ctx: McpContext,
  pageSize: number,
): { readonly items: readonly Value[]; readonly nextCursor?: string } {
  const subject = subjectFor(ctx);
  const afterKey = decodeCursor(cursor, surface, subject);
  const start = afterKey ? entries.findIndex((entry) => entry.key === afterKey) + 1 : 0;
  if (afterKey && start === 0) throw invalidCursor();

  const page = entries.slice(start, start + pageSize);
  const next = entries[start + pageSize];
  const last = page[page.length - 1];
  return {
    items: page.map((entry) => entry.value),
    ...(next && last
      ? {
          nextCursor: cursorCodec.encode({
            v: CURSOR_VERSION,
            surface,
            subject,
            key: last.key,
          }),
        }
      : {}),
  };
}
