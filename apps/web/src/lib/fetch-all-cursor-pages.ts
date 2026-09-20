import type { RpcResponse } from './query-core';

interface CursorPage<Item> {
  readonly items: readonly Item[];
  readonly nextCursor?: string | undefined;
}

type ResponseBody<ResponseType extends RpcResponse<unknown>> = Awaited<
  ReturnType<ResponseType['json']>
>;
type SuccessfulPage<ResponseType extends RpcResponse<unknown>> = Extract<
  ResponseBody<ResponseType>,
  CursorPage<unknown>
>;
type PageItem<ResponseType extends RpcResponse<unknown>> =
  SuccessfulPage<ResponseType> extends {
    readonly items: readonly (infer Item)[];
  }
    ? Item
    : never;

/** The exhausted aggregate returned after a first-party client consumes a complete cursor list. */
export interface CompleteCursorPage<Item> {
  readonly items: readonly Item[];
}

function isCursorPage(value: unknown): value is CursorPage<unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const page = value as { readonly items?: unknown; readonly nextCursor?: unknown };
  return (
    Array.isArray(page.items) &&
    (page.nextCursor === undefined ||
      (typeof page.nextCursor === 'string' && page.nextCursor.length > 0))
  );
}

/**
 * Consume an entire cursor collection for a first-party selector that requires the complete set.
 *
 * @remarks
 * Public list endpoints return at most 100 rows. Detail composites and option pickers still need a
 * complete corpus, so they call this helper with `limit: 100` and pass the supplied cursor back on
 * each request. A failed later page replaces the partial aggregate. Repeated cursors fail closed
 * rather than spinning forever on a broken server response.
 *
 * @typeParam ResponseType - The typed Hono response for one page request.
 * @param fetchPage - Fetches one page for the supplied opaque cursor.
 * @returns A response-shaped exhausted aggregate, or the original failed response.
 * @throws {TypeError} When a successful response is not a cursor page or repeats a cursor.
 */
export async function fetchAllCursorPages<ResponseType extends RpcResponse<unknown>>(
  fetchPage: (cursor: string | undefined) => Promise<ResponseType>,
): Promise<RpcResponse<CompleteCursorPage<PageItem<ResponseType>>>> {
  const items: PageItem<ResponseType>[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let firstResponse: ResponseType | undefined;

  do {
    const response = await fetchPage(cursor);
    firstResponse ??= response;
    if (!response.ok) {
      return response as unknown as RpcResponse<CompleteCursorPage<PageItem<ResponseType>>>;
    }
    const page = await response.json();
    if (!isCursorPage(page)) throw new TypeError('Successful list response is not a cursor page');
    items.push(...(page.items as PageItem<ResponseType>[]));
    cursor = page.nextCursor;
    if (cursor) {
      if (seenCursors.has(cursor)) throw new TypeError('Server returned a repeated cursor');
      seenCursors.add(cursor);
    }
  } while (cursor);

  return {
    ok: true,
    status: firstResponse.status,
    ...(firstResponse.url ? { url: firstResponse.url } : {}),
    json: async () => ({ items }),
  };
}
