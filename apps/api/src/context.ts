/**
 * `@docket/api` — the Hono environment bindings (`Variables`) shared by every route.
 */
import type { auth } from '@docket/auth';

/** The Better Auth session result (`{ session, user }` or null). */
export type AuthSession = Awaited<ReturnType<typeof auth.api.getSession>>;

/** The service-operator staff tiers, in ascending privilege rank. */
export type StaffRole = 'support' | 'finance' | 'superadmin';

/** The resolved staff context set by {@link staffMiddleware} for `/admin/*` routes. */
export interface StaffCtx {
  /** The `staff_user` row id (the operator's staff record). */
  readonly staffUserId: string;
  /** The underlying global `user` id the staff record is keyed to. */
  readonly userId: string;
  /** The operator's staff tier (support → finance → superadmin). */
  readonly role: StaffRole;
}

/** The resolved org-scoped actor context set by the org-context middleware. */
export interface ActorCtx {
  /** The active organization id (from the route path). */
  readonly orgId: string;
  /** The caller's human Actor id within that org. */
  readonly actorId: string;
  /** The actor's role id, if any. */
  readonly roleId: string | null;
  /** The capabilities the actor's role confers org-wide. */
  readonly capabilities: readonly string[];
}

/** The Hono generic for Docket routes: the session + (within org routes) the actor context. */
export interface AppEnv {
  Variables: {
    /** The authenticated session, or null. */
    session: AuthSession;
    /** The org-scoped actor context (set on `/orgs/:orgId/*`). */
    actorCtx: ActorCtx;
    /** The service-operator staff context (set on `/admin/*`). */
    staffCtx: StaffCtx;
  };
}
