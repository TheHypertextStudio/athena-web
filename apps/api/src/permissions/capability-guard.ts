/**
 * `@docket/api` — capability guard middleware.
 *
 * @remarks
 * Runs AFTER `orgContextMiddleware` (which loads `actorCtx.capabilities` from the
 * actor's role). Requires that the actor holds — by the rank cascade — at least the
 * `required` capability; otherwise 403. The full resource-level cascade lives in
 * `@docket/authz`'s `canActor` and is wired per-resource in the P6 lanes.
 */
import { type Capability, satisfies } from '@docket/authz';
import type { MiddlewareHandler } from 'hono';

import type { AppEnv } from '../context';
import { CapabilityError } from '../error';

/** Guard a route by requiring `required` from the actor's org-level capabilities. */
export function capabilityGuard(required: Capability): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const held = c.get('actorCtx').capabilities as Capability[];
    if (!held.some((cap) => satisfies(cap, required))) throw new CapabilityError();
    await next();
  };
}
