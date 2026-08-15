# Docket — REST conventions

> **Area:** `api` · **App:** `apps/api` (Hono 4.x) · **Enforced by** `apps/api/tests/routes/rest-conformance.test.ts` and `rest-mechanics.test.ts` · **Companion to** [`api-rpc-contract.md`](./api-rpc-contract.md), which owns the route inventory.

You are here because you are adding or changing an endpoint on `/v1` or `/admin`. This document tells you the shape it must take. The route inventory, the capability model, and the validation strategy live in the API contract spec; nothing here repeats them.

Two test files enforce every rule below. If you break one you will find out at `pnpm test`, not in review.

## The shape of a URL

A path segment names a **thing**, never an operation. `POST /tasks/:id/state` says "do the state to the task"; `PUT /tasks/:id/state` says "the task's state is now this". The second is addressable, cacheable, and idempotent; the first is a procedure call wearing a URL.

- Collections are plural nouns (`/tasks`, `/statuses`), members sit one segment below (`/tasks/:taskId`).
- Segments are lower-kebab-case (`/saved-views`, `/recurrence-series`). No camelCase, no underscores.
- No trailing slash. `/tasks/` and `/tasks` would be two resources, and only one of them exists.
- Org-scoped resources nest under `/orgs/:orgId`, so the tenant key is always a path parameter and never a body field.

When an operation genuinely is not CRUD, model it as the **state it sets** rather than the verb that sets it:

| Instead of                                                | Write                                                  |
| --------------------------------------------------------- | ------------------------------------------------------ |
| `POST /sessions/:id/approve`, `POST /sessions/:id/reject` | `PUT /sessions/:id/decision` with `{ decision }`       |
| `POST /records/:id/start`, `/pause`, `/stop`              | `PUT /records/:id/status` with `{ status }`            |
| `POST /suggestions/:id/accept`, `/dismiss`                | `PUT /suggestions/:id/disposition` with `{ decision }` |

The test rejects a path whose last literal segment is an imperative — the list lives in `ACTION_VERBS` in `rest-conformance.test.ts`. Routes that predate this rule sit in `LEGACY_ACTION_PATHS`, described under [Known exceptions](#known-exceptions).

## Choosing a method

| Method   | Means                                                                            | Idempotent |
| -------- | -------------------------------------------------------------------------------- | ---------- |
| `GET`    | Read. No side effect a caller could detect.                                      | yes        |
| `POST`   | Create a member of the collection addressed, or run a genuine controller action. | no         |
| `PUT`    | Replace what is at this URI — a member, a singleton, or a whole set.             | yes        |
| `PATCH`  | Merge the supplied fields into the resource. Absent fields are untouched.        | yes        |
| `DELETE` | Remove or archive what is at this URI.                                           | yes        |

Two rules the conformance test checks directly:

- **`PUT` never addresses a collection.** `PUT /grants` claims to replace every grant while in fact upserting one, and a client cannot tell from the contract that the others survive. Write `PUT /grants/:grantId`. A `PUT` to a path with no members — `/preferences`, `/decision`, `/status` — is a singleton and is correct. The test derives "has members" from the route table itself: a path is a collection when some other route addresses `<path>/:param` below it.
- **Nothing is write-only.** Every `PATCH` and `PUT` target must be readable, either at its own URI or through an ancestor whose representation contains it. A resource you can change but never read has no state a client can reason about, which is what made `PATCH /time/records/:id` a bug for as long as no `GET` sat beside it.

An empty `PATCH` body is a no-op that returns the resource unchanged, not a `400`. A client that computed an empty diff should not have to special-case it.

## Status codes

| Code  | When                                                                                     | Also send                        |
| ----- | ---------------------------------------------------------------------------------------- | -------------------------------- |
| `200` | A read, or a write whose effect is complete.                                             | `ETag` on `GET`                  |
| `201` | A resource was created.                                                                  | `Location`                       |
| `202` | The work was queued and has not finished.                                                | `Location` of the status monitor |
| `204` | Success with genuinely nothing to say. Prefer `200` with the resource.                   |                                  |
| `304` | The caller's `If-None-Match` already names the current representation.                   | `ETag`                           |
| `405` | The path exists under a different method.                                                | `Allow`                          |
| `412` | The caller's `If-Match` names a version the resource no longer has.                      |                                  |
| `422` | The body failed validation, or an `Idempotency-Key` was reused with a different request. |                                  |

Use the helpers in `src/lib/ok.ts` rather than setting a status by hand:

```ts
return created(c, TaskOut, toOut(row)); // 201 + Location, derived from the collection
return created(c, TaskOut, out, someOtherUrl); // 201 + an explicit Location
return accepted(c, SyncRunOut, run, monitorUrl); // 202 + where to poll
return ok(c, TaskOut, out); // 200, plus ETag on a GET
```

Declare the same code to OpenAPI through `apiDoc({ status })`, so the published reference and the runtime response cannot drift. Where a handler genuinely branches — the agent-session routes answer `200` inline and `202` when the durable runner takes the work — pass both: `apiDoc({ status: [200, 202] })`. Documenting one of two real outcomes tells a client the other is a failure.

**Set the status on the context, never as a second argument to `c.json`.** Passing a literal narrows the Hono RPC response type to that single code, which types `res.ok` as literal `true` and makes every `if (!res.ok)` branch in `apps/web` dead code the compiler flags — while the server can still answer `403` or `409` on that same call. The helpers already do this correctly.

### `Location` must be true

`created(c, schema, data)` derives `Location` from the request path and the body's `id`, which is right for a `POST` to the resource's own collection. It is wrong wherever the new resource lives somewhere else — a subtask created through `POST /tasks/:id/subtasks` is addressed at `/tasks/:newId`, not below its parent. Pass the URL explicitly in those cases. A resource whose response body has no `id` gets no `Location`, which is legal; a `Location` pointing at nothing is not.

## Errors

Every failure is an RFC 9457 problem document served as `application/problem+json`, carrying a stable `code` from the closed catalog in `@docket/types`. Throw a typed error from `src/error.ts` and let `onError` render it; never build an error response in a handler.

`title` comes from the code catalog, never from the thrown `Error.message` — a server exception can carry configuration keys, provider payloads, or SQL detail, and none of that is interface copy. Add a new code to `ProblemCode` rather than overloading `conflict` when clients need to branch.

An unmatched request goes through `unmatchedRoute`, which answers `405` with `Allow` when the path exists under another method and `404` otherwise — both as problem documents, so a client parsing the documented error shape never gets a surprise.

## Retry safety

`POST` is the one unsafe method HTTP gives no retry story for: a client that loses the response cannot know whether the resource was created. Any `POST` on `/v1` may carry an `Idempotency-Key` header, and the `idempotency` middleware handles the rest:

- The first attempt runs and its outcome is recorded against `(user_id, key)`.
- A later attempt with the same key replays that outcome and sets `Idempotency-Replayed: true`.
- The same key against a _different_ request body is a client bug, and gets `422 idempotency_key_reuse` rather than someone else's response.
- A failed attempt records nothing, so the key stays usable — retrying a create that 500ed is the whole point.
- Records expire after 24 hours.

Keys are scoped per user, so one caller's key can never replay another's response. Handlers need no code for any of this.

## Conditional requests

`ok` emits a strong `ETag` on every `GET`, hashed from the exact bytes it returns, and answers a matching `If-None-Match` with `304`.

The same tag is the currency of conditional writes. A client that sends `If-Match` on a `PUT`, `PATCH`, or `DELETE` gets `412` if the resource changed since it read — the lost-update guard for a product where two tabs editing one task is ordinary. The `preconditions` middleware resolves the current tag by asking the app for a real `GET` of the very URI being written, so the value compared is by construction the one the caller's last read handed them, whatever that resource's representation happens to be. Handlers need no code for this either.

Two deliberate limits:

- **It is opt-in.** A request with no `If-Match` still writes last-writer-wins. Requiring the header everywhere (`428 Precondition Required`) is the stricter reading of RFC 9110 §13.1.1 and is not what this API does: the guarantee is "you can protect a write", not "every write is protected".
- **A URI with no readable representation cannot satisfy any precondition, including `*`.** A caller asserting the version of something it could never have read is mistaken about what it is writing.

The cost is one extra read, paid only by a request that opted in.

## Content negotiation

Every endpoint produces `application/json`, and errors the `application/problem+json` flavour of
it. Two checks run before any handler, in `src/lib/media-types.ts`:

- A request that carries a body must declare a `Content-Type` this API reads —
  `application/json` (or any `+json` suffix), `multipart/form-data`, or
  `application/x-www-form-urlencoded`. Anything else is `415` with an `Accept` response header
  naming what would have worked. **A body with no `Content-Type` at all is also `415`**, because
  Hono's validator declines to parse an undeclared body and hands the schema an empty object —
  which used to surface as a `422` complaining that fields were missing from a request that
  plainly sent them. A request with no body is never asked for a type.
- An `Accept` header that excludes everything this API produces is `406`. A missing header, a
  wildcard, or a `+json` suffix all mean "anything will do". A range marked `q=0` is an explicit
  refusal and does not count as coverage.

## Caching

Every `/v1` and `/admin` response is one person's view of one workspace, and now carries an
`ETag`. A validator with no freshness directive invites a cache to apply a _heuristic_ lifetime
(RFC 9111 §4.2.2) and reuse the stored response, so silence here is not neutral. The default,
applied by `src/lib/cache-policy.ts`, is:

```
Cache-Control: private, no-cache
Vary: Cookie, Authorization
```

`no-cache` does not mean "do not store". It means "do not reuse without revalidating", which is
exactly what an `ETag` is for: the browser keeps the body, sends `If-None-Match`, and gets a
`304`. `private` keeps shared caches out entirely, and `Vary` is the defence in depth that stops
a misconfigured one keying an entry by URL alone. A handler that has said something more
specific — the immutable document-image URL, the SSE streams — keeps its own answer.

## What a browser can actually see

CORS is part of the contract, not a deployment detail. A response header absent from
`exposeHeaders` is on the wire and invisible to script, and a request header absent from
`allowHeaders` fails preflight and is never sent at all. So `src/cors.ts` is where `Location`,
`ETag`, `Allow`, `Idempotency-Replayed`, and `Retry-After` become readable, and where `If-Match`,
`If-None-Match`, and `Idempotency-Key` become sendable. **Adding a header to the protocol without
adding it there ships a feature no browser client can use.**

## Authentication challenges

RFC 9110 §15.5.2 makes `WWW-Authenticate` mandatory on `401`, and `onError` emits
`Bearer realm="docket", error="<code>"` on every one. The `error` parameter carries the problem
code, so `unauthorized` and `reauth_required` are distinguishable from the header alone — a
client that must re-verify a passkey should not treat it as a sign-out.

## Pagination and filtering

List endpoints are keyset-paginated through the shared `ListQuery` / `Page<T>` pair: pass `cursor` and `limit`, read `nextCursor` (null on the last page). Filters are typed query parameters, documented per resource. Never accept a filter in a `POST` body to work around a long query string — that turns a read into an unsafe, uncacheable request.

## Known exceptions

`rest-conformance.test.ts` carries two frozen allowlists. Every entry is a URL some client already calls, grandfathered rather than blessed. **They may shrink and must never grow** — a companion assertion fails when an entry names a route that no longer exists, so a stale exemption cannot silently license a new endpoint onto the old shape.

`LEGACY_ACTION_PATHS` holds paths that still name an action. Most are one of three kinds:

- **State transitions** that should become a status or lifecycle sub-resource: the session `pause`/`resume`/`cancel` trio, `billing/lifecycle/reactivate`, `cycles/:id/close`.
- **Verification and authorization ceremonies** — `contact-points/:id/verify`, `integrations/mcp/:id/authorize`, `publishing/domains/:id/verify` — which want to become a `verifications` or `authorizations` sub-collection, so an attempt is a resource with a result rather than a fire-and-forget call.
- **Genuine controller actions** with no resource behind them, such as `me/calendar/sync` and `mentions/hydrate`. REST tolerates a controller resource; these are the ones likeliest to stay.

`LEGACY_MEMBER_UPSERT_PUTS` is empty. It held two entries and both are fixed: team membership moved to `PUT /orgs/:orgId/teams/:teamId/members/:actorId`, where the member's `DELETE` already lived, and the grant upsert became `POST /orgs/:orgId/grants` — the right method there, because a grant is keyed by a natural tuple with a server-assigned id, so a caller has no address to `PUT` to until it exists. That one answers `201` with a `Location` for a new tuple and `200` when it overwrote, which needs a read before the write since the table carries no `updatedAt` to tell the two apart.

## What this document does not cover

The route inventory, the capability model, Zod-in-and-out validation, the Hono RPC `AppType` export rule, and the OpenAPI/Scalar generation strategy all live in [`api-rpc-contract.md`](./api-rpc-contract.md). The `/internal/*` machine edges — webhooks, provider ingest, cron — are outside both contracts and outside these conventions: they are self-authenticated endpoints shaped by the callers that already exist, not resources anyone browses.
