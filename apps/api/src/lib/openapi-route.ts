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
 * The OpenAPI generator derives security from the same operation access registry the runtime
 * enforces. Route prose and response metadata do not carry a second access-policy source.
 */
import { type Capability } from '@docket/authz';
import { describeRoute, resolver } from 'hono-openapi';
import type { DescribeRouteOptions } from 'hono-openapi';
import { z } from 'zod';

import type { StatusCode } from 'hono/utils/http-status';
import type { MiddlewareHandler } from 'hono';

import type { AppEnv } from '../context';
import { ApiError } from '../error';
import {
  API_OPERATION_CONTRACT,
  assertApiOperationContract,
  renderOperationNarrative,
  type ApiOperationContract,
  type ApiSuccess,
} from './api-operation-contract';
import { idempotencyFor } from './idempotency';
import { operationMediaTypes } from './media-types';
import { conditionalWriteFor } from './work-schedule-conditional';

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
  /** Extra `describeRoute` fields such as operation-specific response headers or extensions. */
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
function legacyApiDoc(opts: ApiDocOptions): MiddlewareHandler<AppEnv> {
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

function isOperationContract(
  options: ApiDocOptions | ApiOperationContract,
): options is ApiOperationContract {
  return 'operationId' in options;
}

type DocumentedSchema =
  ReturnType<typeof resolver> | { readonly type: 'string'; readonly format?: 'uri' | 'binary' };

interface DocumentedResponse {
  readonly description: string;
  readonly headers?: Readonly<
    Record<
      string,
      {
        readonly description: string;
        readonly schema: DocumentedSchema;
      }
    >
  >;
  readonly content?: Readonly<
    Record<
      string,
      {
        readonly schema: DocumentedSchema;
        readonly examples?: Readonly<
          Record<string, { readonly summary: string; readonly value: string }>
        >;
        readonly 'x-docket-events'?: readonly {
          readonly name: string;
          readonly description: string;
          readonly schema: unknown;
          readonly example: string;
        }[];
      }
    >
  >;
}

function successResponse(outcome: ApiSuccess): DocumentedResponse {
  switch (outcome.kind) {
    case 'json':
      return {
        description: outcome.description,
        ...(outcome.location
          ? {
              headers: {
                Location: {
                  description:
                    outcome.location === 'monitor'
                      ? 'Absolute URL of the operation status monitor.'
                      : 'Absolute URL of the created resource.',
                  schema: { type: 'string', format: 'uri' },
                },
              },
            }
          : {}),
        content: { 'application/json': { schema: resolver(outcome.schema) } },
      };
    case 'empty':
      return { description: outcome.description };
    case 'binary':
      return {
        description: outcome.description,
        headers: {
          'Content-Disposition': {
            description: `The response is delivered ${outcome.disposition}.`,
            schema: { type: 'string' },
          },
        },
        content: Object.fromEntries(
          outcome.mediaTypes.map((mediaType) => [
            mediaType,
            { schema: { type: 'string', format: 'binary' } },
          ]),
        ),
      };
    case 'sse':
      return {
        description: outcome.description,
        content: {
          'text/event-stream': {
            schema: { type: 'string' },
            examples: Object.fromEntries(
              outcome.events.map((event) => [
                event.name,
                { summary: event.description, value: event.example },
              ]),
            ),
            'x-docket-events': outcome.events.map((event) => ({
              name: event.name,
              description: event.description,
              schema: z.toJSONSchema(event.schema, { io: 'output' }),
              example: event.example,
            })),
          },
        },
      };
  }
}

function strictResponses(
  contract: ApiOperationContract,
): Readonly<Record<string, DocumentedResponse>> {
  const responses: Record<string, DocumentedResponse> = {};
  for (const outcome of contract.success) {
    const response = successResponse(outcome);
    const prior = responses[String(outcome.status)];
    responses[String(outcome.status)] = prior
      ? {
          ...prior,
          description: `${prior.description} ${response.description}`,
          headers: { ...prior.headers, ...response.headers },
          content: { ...prior.content, ...response.content },
        }
      : response;
  }
  return responses;
}

function streamResume(
  contract: ApiOperationContract,
): Extract<ApiSuccess, { readonly kind: 'sse' }>['resume'] | undefined {
  return contract.success.find(
    (outcome): outcome is Extract<ApiSuccess, { readonly kind: 'sse' }> => outcome.kind === 'sse',
  )?.resume;
}

function streamResumeParameters(
  contract: ApiOperationContract,
): DescribeRouteOptions['parameters'] | undefined {
  const resume = streamResume(contract);
  if (resume?.kind !== 'last-event-id') return undefined;
  return [
    {
      name: resume.header,
      in: 'header',
      required: false,
      description: `${resume.description} Replay window: ${resume.replayWindow}`,
      schema: { type: 'string' },
    },
  ];
}

function mediaType(response: Response): string {
  return (response.headers.get('Content-Type')?.split(';')[0] ?? '').trim().toLowerCase();
}

function hasDeclaredLocation(response: Response, outcome: ApiSuccess): boolean {
  const value = response.headers.get('Location');
  if (outcome.kind !== 'json' || outcome.location === undefined) return value === null;
  if (value === null) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

async function jsonResponseMatches(
  response: Response,
  outcome: Extract<ApiSuccess, { readonly kind: 'json' }>,
): Promise<boolean> {
  if (!/^application\/(?:[^;+]+\+)?json$/u.test(mediaType(response))) return false;
  try {
    return outcome.schema.safeParse(await response.clone().json()).success;
  } catch {
    return false;
  }
}

function binaryResponseMatches(
  response: Response,
  outcome: Extract<ApiSuccess, { readonly kind: 'binary' }>,
): boolean {
  const disposition = response.headers.get('Content-Disposition')?.trim().toLowerCase();
  const declaredDisposition = new RegExp(`^${outcome.disposition}(?:;|$)`, 'u');
  return (
    outcome.mediaTypes.map((value) => value.toLowerCase()).includes(mediaType(response)) &&
    declaredDisposition.test(disposition ?? '')
  );
}

function streamResponseMatches(response: Response): boolean {
  return (
    mediaType(response) === 'text/event-stream' &&
    response.headers.get('Cache-Control')?.toLowerCase().includes('no-transform') === true &&
    response.headers.get('X-Accel-Buffering')?.toLowerCase() === 'no' &&
    !response.headers.has('Content-Encoding') &&
    !response.headers.has('ETag')
  );
}

async function responseMatchesOutcome(response: Response, outcome: ApiSuccess): Promise<boolean> {
  if (response.status !== outcome.status || !hasDeclaredLocation(response, outcome)) return false;
  if (outcome.kind === 'json') return jsonResponseMatches(response, outcome);
  if (outcome.kind === 'empty') return response.body === null;
  if (outcome.kind === 'binary') return binaryResponseMatches(response, outcome);
  return streamResponseMatches(response);
}

async function assertRuntimeResponse(
  context: Parameters<MiddlewareHandler<AppEnv>>[0],
  contract: ApiOperationContract,
): Promise<void> {
  if (context.res.status >= 400) return;
  const candidates = contract.success.filter((outcome) => outcome.status === context.res.status);
  for (const outcome of candidates) {
    if (await responseMatchesOutcome(context.res, outcome)) return;
  }
  console.error(
    JSON.stringify({
      level: 'error',
      source: 'api',
      event: 'response_contract_violation',
      operationId: contract.operationId,
      status: context.res.status,
      mediaType: mediaType(context.res),
    }),
  );
  throw new ApiError(500, 'internal', 'Response did not match its declared operation contract');
}

function strictApiDoc(contract: ApiOperationContract): MiddlewareHandler<AppEnv> {
  assertApiOperationContract(contract);
  const resume = streamResume(contract);
  const parameters = streamResumeParameters(contract);
  const routeOptions = {
    operationId: contract.operationId,
    summary: contract.summary,
    tags: [contract.tag],
    description: renderOperationNarrative(contract),
    // `openapi-types` does not model vendor extensions inside media-type objects. The value is
    // otherwise a normal response map, and generation retains `x-docket-events` verbatim.
    responses: strictResponses(contract) as NonNullable<DescribeRouteOptions['responses']>,
    ...(parameters ? { parameters } : {}),
    ...(contract.capability ? { 'x-docket-capability': contract.capability } : {}),
    'x-docket-access': contract.access,
    'x-docket-errors': contract.errors,
    'x-docket-conditional-read': contract.conditionalRead,
    'x-docket-conditional-write': contract.conditionalWrite,
    'x-docket-idempotency': contract.idempotency,
    'x-docket-related-operations': contract.related,
    ...(resume ? { 'x-docket-stream-resume': resume } : {}),
  } as unknown as DescribeRouteOptions;
  const documented = describeRoute(routeOptions);
  const negotiate = operationMediaTypes(contract);
  const enforceConditionalWrite = conditionalWriteFor(contract.conditionalWrite);
  const enforceIdempotency = idempotencyFor(contract.idempotency);
  const runtime: MiddlewareHandler<AppEnv> = async (context, next) => {
    await negotiate(context, async () => {
      await enforceConditionalWrite(context, async () => {
        const response = await enforceIdempotency(context, async () => {
          await next();
          await assertRuntimeResponse(context, contract);
        });
        if (response !== undefined) {
          if (!context.finalized) context.res = response;
          await assertRuntimeResponse(context, contract);
        }
      });
    });
  };
  return Object.assign(runtime, documented, {
    [API_OPERATION_CONTRACT]: contract,
  });
}

/**
 * Build one operation's documentation and runtime metadata middleware.
 *
 * Legacy options remain accepted only while Task 4 migrates every public declaration.
 */
export function apiDoc(options: ApiDocOptions | ApiOperationContract): MiddlewareHandler<AppEnv> {
  return isOperationContract(options) ? strictApiDoc(options) : legacyApiDoc(options);
}
