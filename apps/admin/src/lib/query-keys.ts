/**
 * The admin console's query-key convention.
 *
 * @remarks
 * Keys are hierarchical and read outside-in (`['admin', 'orgs', 'list', filters]`), so a coarse
 * invalidation is a prefix match that also covers the finer keys beneath it: invalidating
 * {@link queryKeys.orgs} refreshes every org list *and* every org detail, without any call site
 * enumerating them.
 *
 * Every key begins with `admin` because the console also reads a few product `/v1/*` routes
 * through `productApi`; the shared prefix keeps the two namespaces from ever colliding in one
 * cache.
 */

/** A list query's filter arguments, folded into its key so each filter combination caches apart. */
export interface ListKeyArgs {
  /** The active free-text search term, or an empty string. */
  readonly search?: string | undefined;
  /** An active lifecycle-state filter, when the list supports one. */
  readonly lifecycleState?: string | undefined;
}

/** The console's query keys, one factory per cached read. */
export const queryKeys = {
  /** Everything the console caches. Invalidate to refetch the whole console. */
  all: ['admin'] as const,

  /** The signed-in operator's staff identity and tier. */
  session: () => [...queryKeys.all, 'session'] as const,

  /** Headline platform metrics. */
  staff: () => [...queryKeys.all, 'staff'] as const,
  athenaUsage: () => [...queryKeys.all, 'athena-usage'] as const,
  status: () => [...queryKeys.all, 'status'] as const,
  resources: () => [...queryKeys.all, 'resources'] as const,
  metrics: () => [...queryKeys.all, 'metrics'] as const,

  /** Every user-scoped read. */
  users: () => [...queryKeys.all, 'users'] as const,
  /** One page of the user list under a given search term. */
  userList: (args: ListKeyArgs) => [...queryKeys.users(), 'list', args] as const,
  /** One user's detail. */
  user: (id: string) => [...queryKeys.users(), 'detail', id] as const,

  /** Every org-scoped read. */
  orgs: () => [...queryKeys.all, 'orgs'] as const,
  /** One page of the org list under a given search term and lifecycle filter. */
  orgList: (args: ListKeyArgs) => [...queryKeys.orgs(), 'list', args] as const,
  /** One org's detail. */
  org: (id: string) => [...queryKeys.orgs(), 'detail', id] as const,
  /** One org's billing state. */
  orgBilling: (id: string) => [...queryKeys.orgs(), 'billing', id] as const,

  /** The finance discount-application queue. */
  discounts: () => [...queryKeys.all, 'discounts'] as const,
  /** One discount application's review detail. */
  discount: (id: string) => [...queryKeys.discounts(), 'detail', id] as const,

  /** The service-announcement console. */
  notifications: () => [...queryKeys.all, 'notifications'] as const,
  /** One announcement intent and its review payloads. */
  notification: (id: string) => [...queryKeys.notifications(), 'detail', id] as const,

  /** The operator audit trail. */
  audit: () => [...queryKeys.all, 'audit'] as const,

  /** The legacy retention board. */
  lifecycle: () => [...queryKeys.all, 'lifecycle'] as const,

  /** The instance-wide service controls. */
  serviceControls: () => [...queryKeys.all, 'service-controls'] as const,
} as const;
