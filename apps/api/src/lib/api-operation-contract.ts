/** `@docket/api` — the shared public operation declaration and runtime lookup. */
import type { Capability } from '@docket/authz';
import type { Context, Hono } from 'hono';
import { matchedRoutes } from 'hono/route';
import type { z } from 'zod';

import type { ApiAccess } from '../auth/rest-access-policy';
import type { AppEnv } from '../context';
import type { ProblemCode } from '../contracts/errors';
import type { PublicTagId } from './public-api-tags';

/** A stable operation identifier used by OpenAPI, links, and release comparisons. */
export type OperationId = string;

/** A mutable aggregate that has a real transaction-bound conditional-write adapter. */
export type ConditionalResourceKind = 'work-schedule';

/** One named event emitted on an SSE operation. */
export interface ApiStreamEvent {
  readonly name: string;
  readonly description: string;
  readonly schema: z.ZodType;
  readonly example: string;
}

/** The resume contract for one SSE operation. */
export type ApiStreamResume =
  | {
      readonly kind: 'none';
      readonly description: string;
    }
  | {
      readonly kind: 'last-event-id';
      readonly header: 'Last-Event-ID';
      readonly replayWindow: string;
      readonly description: string;
    };

/** A documented successful outcome and its runtime representation policy. */
export type ApiSuccess =
  | {
      readonly kind: 'json';
      readonly status: 200 | 201 | 202;
      readonly schema: z.ZodType;
      readonly description: string;
      readonly location?: 'resource' | 'monitor';
    }
  | {
      readonly kind: 'empty';
      readonly status: 204;
      readonly description: string;
    }
  | {
      readonly kind: 'binary';
      readonly status: 200;
      readonly mediaTypes: readonly string[];
      readonly disposition: 'inline' | 'attachment';
      readonly description: string;
    }
  | {
      readonly kind: 'sse';
      readonly status: 200;
      readonly events: readonly ApiStreamEvent[];
      readonly resume: ApiStreamResume;
      readonly description: string;
    };

/** One complete public operation contract used by runtime and documentation generation. */
export interface ApiOperationContract {
  readonly operationId: OperationId;
  readonly tag: PublicTagId;
  readonly summary: string;
  readonly narrative: {
    readonly purpose: string;
    readonly behavior: readonly string[];
    readonly effects?: readonly string[];
    readonly constraints?: readonly string[];
  };
  readonly access: ApiAccess;
  readonly requestBody?: {
    readonly description: string;
    readonly examples: Readonly<Record<string, unknown>>;
  };
  readonly success: readonly ApiSuccess[];
  readonly errors: readonly ProblemCode[];
  readonly capability?: Capability;
  readonly conditionalRead: boolean;
  readonly conditionalWrite: false | ConditionalResourceKind;
  readonly idempotency: false | 'json-receipt' | 'atomic-receipt';
  readonly related: readonly OperationId[];
}

/** A runtime route and the operation declaration attached to its middleware. */
export interface RegisteredApiOperation {
  readonly method: string;
  readonly path: string;
  readonly contract: ApiOperationContract;
}

/** Metadata key attached to the same middleware that carries hono-openapi documentation. */
export const API_OPERATION_CONTRACT = Symbol('docket.api.operation-contract');

interface ContractHandler {
  readonly [API_OPERATION_CONTRACT]?: ApiOperationContract;
  readonly __COMPOSED_HANDLER?: unknown;
}

function handlerContract(handler: unknown): ApiOperationContract | undefined {
  if ((typeof handler !== 'function' && typeof handler !== 'object') || handler === null) {
    return undefined;
  }
  const candidate = handler as ContractHandler;
  return candidate[API_OPERATION_CONTRACT] ?? handlerContract(candidate.__COMPOSED_HANDLER);
}

/** Read the declared contract from the handlers Hono matched for the current request. */
export function operationContractForRequest(
  context: Context<AppEnv>,
): ApiOperationContract | undefined {
  const contracts = matchedRoutes(context)
    .map((route) => handlerContract(route.handler))
    .filter((contract): contract is ApiOperationContract => contract !== undefined);
  const distinct = [...new Set(contracts)];
  if (distinct.length > 1) {
    throw new Error(
      `Multiple API operation contracts matched ${context.req.method} ${context.req.path}`,
    );
  }
  return distinct[0];
}

/** Collect every contract-bearing runtime route without starting a listener. */
export function collectApiOperationContracts(app: Hono<AppEnv>): readonly RegisteredApiOperation[] {
  return app.routes.flatMap((route) => {
    const contract = handlerContract(route.handler);
    return contract ? [{ method: route.method, path: route.path, contract }] : [];
  });
}

function requireText(value: string, field: string): void {
  if (value.trim() === '') throw new Error(`API operation ${field} must not be empty`);
}

function assertNarrative(contract: ApiOperationContract): void {
  requireText(contract.narrative.purpose, `${contract.operationId} narrative purpose`);
  if (contract.narrative.behavior.length === 0) {
    throw new Error(`API operation ${contract.operationId} narrative behavior must not be empty`);
  }
  contract.narrative.behavior.forEach((item) => {
    requireText(item, `${contract.operationId} behavior`);
  });
  contract.narrative.effects?.forEach((item) => {
    requireText(item, `${contract.operationId} effect`);
  });
  contract.narrative.constraints?.forEach((item) => {
    requireText(item, `${contract.operationId} constraint`);
  });
}

function assertRequestBody(contract: ApiOperationContract): void {
  if (!contract.requestBody) return;
  requireText(contract.requestBody.description, `${contract.operationId} request body description`);
  if (Object.keys(contract.requestBody.examples).length === 0) {
    throw new Error(
      `API operation ${contract.operationId} request body examples must not be empty`,
    );
  }
}

function assertSuccessOutcome(operationId: OperationId, outcome: ApiSuccess): void {
  requireText(outcome.description, `${operationId} response description`);
  if (outcome.kind === 'binary' && outcome.mediaTypes.length === 0) {
    throw new Error(`API operation ${operationId} binary media types must not be empty`);
  }
  if (outcome.kind === 'sse' && outcome.events.length === 0) {
    throw new Error(`API operation ${operationId} stream events must not be empty`);
  }
  if (outcome.kind === 'json' && outcome.status === 202 && outcome.location !== 'monitor') {
    throw new Error(`API operation ${operationId} status 202 requires a monitor Location`);
  }
}

function assertSuccessContract(contract: ApiOperationContract): void {
  if (contract.success.length === 0) {
    throw new Error(`API operation ${contract.operationId} success outcomes must not be empty`);
  }
  for (const outcome of contract.success) {
    assertSuccessOutcome(contract.operationId, outcome);
  }
}

function assertPolicyCombination(contract: ApiOperationContract): void {
  if (contract.conditionalRead && contract.success.some((outcome) => outcome.kind === 'sse')) {
    throw new Error(
      `API operation ${contract.operationId} cannot conditionally read an SSE stream`,
    );
  }
  if (
    contract.idempotency !== false &&
    contract.success.some((outcome) => outcome.kind !== 'json')
  ) {
    throw new Error(
      `API operation ${contract.operationId} cannot record a non-JSON idempotency response`,
    );
  }
}

/** Fail at route registration when a declaration omits a required semantic contract. */
export function assertApiOperationContract(contract: ApiOperationContract): void {
  requireText(contract.operationId, 'operationId');
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(contract.operationId)) {
    throw new Error(`API operationId must be alphanumeric camel case: ${contract.operationId}`);
  }
  requireText(contract.summary, `${contract.operationId} summary`);
  assertNarrative(contract);
  assertRequestBody(contract);
  assertSuccessContract(contract);
  assertPolicyCombination(contract);
  if (new Set(contract.errors).size !== contract.errors.length) {
    throw new Error(`API operation ${contract.operationId} repeats an error code`);
  }
}

function list(items: readonly string[], fallback: string): string {
  return items.length === 0 ? fallback : items.map((item) => `- ${item}`).join('\n');
}

function accessDescription(contract: ApiOperationContract): string {
  switch (contract.access.kind) {
    case 'public':
      return 'No credential is required.';
    case 'session-only':
      return contract.access.stepUp
        ? 'A first-party Docket session with recent step-up verification is required.'
        : 'A first-party Docket session is required. OAuth access tokens are not accepted.';
    case 'session-or-oauth':
      return `A first-party Docket session or an OAuth access token with ${contract.access.scopes.map((scope) => `\`${scope}\``).join(', ')} is required.`;
    case 'share-token':
      return `A valid \`${contract.access.header}\` share token is required.`;
  }
}

/** Render the fixed six-section public operation narrative. */
export function renderOperationNarrative(contract: ApiOperationContract): string {
  const constraints = contract.narrative.constraints ?? [];
  const effects = contract.narrative.effects ?? [];
  const failures = contract.errors.map(
    (code) => `\`${code}\` — Follow the recovery guidance in the documented Problem response.`,
  );
  return [
    '## Purpose',
    contract.narrative.purpose,
    '## Inputs and constraints',
    list(constraints, 'The documented parameter and request schemas define the accepted input.'),
    '## Result and side effects',
    list(
      [...contract.narrative.behavior, ...effects],
      'The operation returns the documented result.',
    ),
    '## Access and permissions',
    [
      accessDescription(contract),
      contract.capability
        ? `Workspace capability: \`${contract.capability}\`.`
        : 'No additional workspace capability is declared.',
    ].join('\n\n'),
    '## Failures and recovery',
    list(failures, 'No operation-specific Problem response is declared.'),
    '## Related operations',
    list(
      contract.related.map((operationId) => `\`${operationId}\``),
      'No related operation is required to complete this workflow.',
    ),
  ].join('\n\n');
}
