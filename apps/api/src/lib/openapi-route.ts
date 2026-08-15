/**
 * `@docket/api` — the per-route OpenAPI annotation helper.
 *
 * @remarks
 * {@link apiDoc} wraps `hono-openapi`'s `describeRoute` so each route declares its docs in
 * one line: the resource tag (drives Scalar's grouped sidebar), a human summary, the
 * `*Out` response schema (the SAME schema passed to {@link ok}, so the documented and
 * runtime responses cannot drift), and the `x-docket-capability` extension that mirrors the
 * route's {@link capabilityGuard}. Request bodies/params are documented automatically by the
 * `validator` calls in {@link ./validate} — this helper only covers the response + metadata.
 *
 * The bearer security requirement is declared once globally (`defaultOptions` in
 * {@link ./../openapi}); public routes opt out with `security: []` here.
 */
import { type Capability } from '@docket/authz';
import { describeRoute, resolver } from 'hono-openapi';
import type { DescribeRouteOptions } from 'hono-openapi';
import type { z } from 'zod';

import type { StatusCode } from 'hono/utils/http-status';

export { describeRoute, resolver };

/** Options for {@link apiDoc}. */
export interface ApiDocOptions {
  /** Resource group tag (one per resource) — renders as a Scalar sidebar section. */
  tag: string;
  /** Short, human-readable summary of the operation. */
  summary: string;
  /** The capability the route's `capabilityGuard` asserts — surfaced as `x-docket-capability`. */
  capability?: Capability;
  /**
   * The `*Out` response schema (same one passed to `ok(c, schema, data)`). Omit for routes
   * that don't return a JSON envelope (SSE, binary, raw literals) — the operation is still
   * documented with its tag, summary, and capability.
   */
  response?: z.ZodType;
  /**
   * Success status code(s) this route can answer with (default 200).
   *
   * @remarks
   * Pass an array when the handler genuinely branches — an agent session that answers `201`
   * when it ran inline and `202` when the durable runner took it is two documented outcomes,
   * not one. Declaring only the branch you happened to write first tells a client the other
   * one is an error. Each listed code is documented with the same response schema, which is
   * the case here: the branches differ in how much work has finished, not in what comes back.
   */
  status?: StatusCode | readonly StatusCode[];
  /**
   * Operation-level description — the main prose Scalar renders for the endpoint (purpose,
   * behavior, side effects, capability rationale, errors, related routes). Markdown.
   */
  description?: string;
  /** Description of the success response body (default 'Success.'). */
  responseDescription?: string;
  /** Extra `describeRoute` fields (e.g. `security: []` for public routes, more responses). */
  extra?: DescribeRouteOptions;
}

/**
 * Build the `describeRoute` middleware for a route from its tag, summary, capability, and
 * response schema.
 *
 * @example
 * ```typescript
 * .post(
 *   '/',
 *   capabilityGuard('contribute'),
 *   apiDoc({ tag: 'Tasks', summary: 'Create a task', capability: 'contribute', response: TaskOut }),
 *   zJson(TaskCreate),
 *   async (c) => ok(c, TaskOut, toOut(row)),
 * )
 * ```
 */
export function apiDoc(opts: ApiDocOptions) {
  const statuses = opts.status === undefined ? [200] : [opts.status].flat();
  const response = opts.response;
  const spec: DescribeRouteOptions = {
    summary: opts.summary,
    tags: [opts.tag],
    // Operation-level prose (what Scalar renders as the endpoint body), NOT the response label.
    ...(opts.description ? { description: opts.description } : {}),
    ...(opts.capability ? { 'x-docket-capability': opts.capability } : {}),
    ...(response
      ? {
          responses: Object.fromEntries(
            statuses.map((status) => [
              status,
              {
                description: opts.responseDescription ?? 'Success.',
                content: { 'application/json': { schema: resolver(response) } },
              },
            ]),
          ),
        }
      : {}),
    ...opts.extra,
  };
  return describeRoute(spec);
}
