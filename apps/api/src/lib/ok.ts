/**
 * `@docket/api` — the output helpers.
 *
 * @remarks
 * Every JSON-returning handler leaves through one of these so the status code, the
 * validator headers, and the documented `*Out` schema stay in one place instead of being
 * re-decided per route:
 *
 * - {@link ok} — `200 OK` for reads and in-place writes. Entity tags and `304` handling are
 *   not here: Hono's own `etag` middleware does that for every response at once (see
 *   `app.ts`), and correctly strips the headers a `304` must not carry.
 * - {@link created} — `201 Created` plus the `Location` of the new resource.
 * - {@link accepted} — `202 Accepted` plus the `Location` of the job resource that tracks
 *   the work, for handlers that queue rather than complete.
 *
 * @see `docs/engineering/specs/rest-conventions.md` for the rules these encode.
 */
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';

import { ApiError } from '../error';
import { env } from '../env';

/**
 * Validate and serialize a response body against its `*Out` schema.
 *
 * @remarks
 * Parsing runs in **every** environment, including production. It used to be skipped when
 * `NODE_ENV === 'production'`, and that made the schemas unenforceable rather than merely
 * unenforced: because the `*Out` objects are non-strict, `parse` *strips* unknown keys, so a
 * handler that accidentally passed a raw Drizzle row produced a correct, clean response in dev
 * and test and serialized the entire row — including columns no schema declares — in production.
 * No environment could observe the difference, so no test could have caught it. The parse is what
 * makes `openapi.ts`'s published claim that "the documented shape is the runtime shape" true.
 *
 * A parse failure is a server bug, never the caller's fault, and it must not escape as a bare
 * `ZodError`: `onError` maps those to a 422 whose `fieldErrors` are keyed by the *output* schema's
 * internal paths, which would both mislead the caller and disclose field names. It becomes a 500
 * with the closed-catalog `internal` title instead.
 *
 * The offending paths are logged here rather than attached as `fieldErrors`, for two reasons that
 * are both properties of `onError`: it renders `fieldErrors` at any status, so a 500 carrying them
 * would disclose exactly what this is trying to withhold; and it logs only errors that are *not*
 * `ApiError`, so an `ApiError` thrown from here would otherwise vanish without a trace.
 *
 * Shared by all three helpers, so a `201` or `202` body is held to exactly the contract a `200`
 * is — a create that skipped this check would reopen the hole from the other side.
 *
 * @param c - The Hono context, for the log line's method and path.
 * @param schema - The response Zod schema.
 * @param data - The data to return (the schema's input shape).
 * @returns the parsed body.
 * @throws {ApiError} 500 `internal` when the data does not satisfy its declared schema.
 */
function serialize<T extends z.ZodType>(c: Context, schema: T, data: z.input<T>): z.output<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    console.error(
      JSON.stringify({
        level: 'error',
        source: 'api',
        event: 'response_contract_violation',
        method: c.req.method,
        path: c.req.path,
        // Paths and issue codes only — never the values, which are the response data itself.
        issues: result.error.issues.map((issue) => ({
          code: issue.code,
          path: issue.path.join('.'),
        })),
      }),
    );
    throw new ApiError(500, 'internal', 'Response body did not match its declared schema');
  }
  return result.data;
}

/**
 * Set the response status without pinning it into the RPC contract.
 *
 * @remarks
 * Passing a literal status to `c.json(body, 201)` narrows the response type to that one code,
 * and Hono's client then types `res.ok` as the literal `true` — every `if (!res.ok)` branch in
 * `apps/web` becomes statically dead code the compiler flags, while the server can still answer
 * `403`, `409`, or `500` on that same call. The narrow type is the lie, not the branch.
 *
 * Setting the status on the context instead leaves `c.json(body)` inferring the open status
 * union a caller can still test, and Hono applies the status that was set. The literal survives
 * where it belongs: in the response actually sent, and in the `status` the route declares to
 * OpenAPI through `apiDoc`.
 */
function withStatus(c: Context, status: ContentfulStatusCode): void {
  c.status(status);
}

/**
 * Validate and return a `200 OK` JSON body.
 *
 * @remarks
 * Takes the schema's **input** type (pre-brand) so plain DB strings satisfy branded
 * `*Out` id fields; parsing produces the branded output the RPC client sees.
 *
 * @param c - The Hono context.
 * @param schema - The response Zod schema.
 * @param data - The data to return (the schema's input shape).
 * @returns the JSON response, typed as the schema's output.
 * @throws {ApiError} 500 `internal` when the data does not satisfy its declared schema.
 */
export function ok<T extends z.ZodType>(c: Context, schema: T, data: z.input<T>) {
  return c.json(serialize(c, schema, data));
}

/**
 * The absolute URL of a resource, from a path already rooted at the API host.
 *
 * @param path - An absolute path including its version prefix, e.g. `/v1/orgs/x/tasks/y`.
 */
export function resourceUrl(path: string): string {
  return `${env.API_URL}${path}`;
}

/**
 * The URL of a member of the collection now being handled.
 *
 * @remarks
 * A create is a `POST` to the collection, so the new member sits one segment below the
 * request path. Deriving it here rather than at each call site keeps `Location` correct
 * when a router is remounted under a different prefix.
 *
 * @param c - The Hono context for the create request.
 * @param id - The new resource's identifier.
 */
export function memberUrl(c: Context, id: string): string {
  return resourceUrl(`${new URL(c.req.url).pathname.replace(/\/$/, '')}/${encodeURIComponent(id)}`);
}

/**
 * Validate and return a `201 Created` JSON body with a `Location` header.
 *
 * @remarks
 * `200` on a create tells a client the request succeeded and nothing else; `201` plus
 * `Location` also tells it where the thing it just made now lives, which is the only way a
 * caller that did not choose the id can address the result without guessing the URL scheme.
 *
 * Omit `location` when the new resource is a member of the collection being posted to — the
 * ordinary case, where it is derived from the request path and the body's `id`. Pass it
 * explicitly whenever the canonical URL is somewhere else: a subtask created through
 * `POST /tasks/:id/subtasks` is addressed at `/tasks/:newId`, not below its parent, and a
 * wrong `Location` misleads more than an absent one.
 *
 * @param c - The Hono context.
 * @param schema - The response Zod schema.
 * @param data - The created resource (the schema's input shape).
 * @param location - The new resource's URL, when it is not a member of this collection.
 * @throws {ApiError} 500 `internal` when the data does not satisfy its declared schema.
 */
export function created<T extends z.ZodType>(
  c: Context,
  schema: T,
  data: z.input<T>,
  location?: string,
) {
  const body = serialize(c, schema, data);
  const id: unknown = (body as { id?: unknown }).id;
  const url = location ?? (typeof id === 'string' ? memberUrl(c, id) : undefined);
  if (url !== undefined) c.header('Location', url);
  withStatus(c, 201);
  return c.json(body);
}

/**
 * Validate and return a `202 Accepted` JSON body for work that has been queued.
 *
 * @remarks
 * Use this wherever the handler returns before the work is done — imports, syncs,
 * materializations, exports. `200` would claim the effect has already happened, and a client
 * that believes it stops polling. The `Location` names the resource that reports progress.
 *
 * @param c - The Hono context.
 * @param schema - The response Zod schema.
 * @param data - The queued job (the schema's input shape).
 * @param location - The job/status resource to poll, when there is one.
 * @throws {ApiError} 500 `internal` when the data does not satisfy its declared schema.
 */
export function accepted<T extends z.ZodType>(
  c: Context,
  schema: T,
  data: z.input<T>,
  location?: string,
) {
  if (location !== undefined) c.header('Location', location);
  withStatus(c, 202);
  return c.json(serialize(c, schema, data));
}
