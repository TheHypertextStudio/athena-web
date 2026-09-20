/**
 * `@docket/api` — fail-closed access declarations for public REST operations.
 */
import type {
  OAuthCapabilityScope,
  OAuthIssuableScope,
} from '@docket/identity-access/oauth-scope-contract';
import type { Context } from 'hono';

import type { AppEnv } from '../context';
import { operationContractForRequest } from '../lib/api-operation-contract';

/** The authentication mechanism and OAuth scopes one REST operation accepts. */
export type ApiAccess =
  | { readonly kind: 'public' }
  | { readonly kind: 'session-only'; readonly stepUp?: boolean }
  | {
      readonly kind: 'session-or-oauth';
      readonly scopes: readonly OAuthCapabilityScope[];
    }
  | { readonly kind: 'share-token'; readonly header: 'X-Docket-Share-Token' };

/** Human-readable descriptions for every scope the REST authorization flow can request. */
export const REST_OAUTH_SCOPE_DESCRIPTIONS: Readonly<Record<OAuthIssuableScope, string>> = {
  'work:read':
    'View workspace structure, work, comments, updates, search, saved views, schedules, calendars, time, and your notifications.',
  'work:write':
    'Create and update work, comments, plans, schedules, time records, notification read state, and published brief content.',
  'agents:run':
    'Start, steer, resume, and cancel Athena or agent sessions, use voice sessions, and approve or reject proposed actions.',
  'connectors:link':
    'Connect, configure, disconnect, and run integrations with other tools you use.',
  offline_access: 'Keep working on your behalf without asking you to sign in again.',
};

const SESSION_ONLY = { kind: 'session-only' } as const satisfies ApiAccess;
const ORG_LIST_ACCESS = {
  kind: 'session-or-oauth',
  scopes: ['work:read'],
} as const satisfies ApiAccess;

/**
 * Task 2's deliberately narrow manifest. Task 3 folds this registry into full operation
 * contracts; until then, every absent method and path remains session-only.
 */
export const REST_OPERATION_ACCESS: ReadonlyMap<string, ApiAccess> = new Map<string, ApiAccess>([
  ['GET /v1/config', { kind: 'public' }],
  ['GET /v1/orgs', ORG_LIST_ACCESS],
  ['HEAD /v1/orgs', ORG_LIST_ACCESS],
  ['GET /v1/public/time/status', { kind: 'share-token', header: 'X-Docket-Share-Token' }],
]);

/** Return the exact operation policy, defaulting unknown operations to session-only. */
export function accessForOperation(method: string, path: string): ApiAccess {
  return REST_OPERATION_ACCESS.get(`${method.toUpperCase()} ${path}`) ?? SESSION_ONLY;
}

/** Select access from the matched operation contract, with the temporary Task 2 fallback. */
export function accessForRequest(context: Context<AppEnv>): ApiAccess {
  return (
    operationContractForRequest(context)?.access ??
    accessForOperation(context.req.method, context.req.path)
  );
}
