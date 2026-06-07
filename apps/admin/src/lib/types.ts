import type { InferResponseType } from 'hono/client';

import type { api } from '@/lib/api';

/**
 * The operator dashboard metrics (`GET /v1/admin/metrics`).
 *
 * @remarks
 * Derived from the typed RPC client rather than importing the API's internal DTO modules:
 * `@docket/api` publicly exposes only the `AppType` contract, so every admin shape is
 * inferred from the corresponding route's success response. This keeps the admin types in
 * lockstep with the server contract at compile time.
 */
export type AdminMetrics = InferResponseType<typeof api.v1.admin.metrics.$get>;

/** A page of users (`GET /v1/admin/users`): `{ items, total }`. */
export type AdminUserPage = InferResponseType<typeof api.v1.admin.users.$get>;

/** A single user row in the admin user list. */
export type AdminUser = AdminUserPage['items'][number];

/** A user plus their cross-org memberships (`GET /v1/admin/users/:id`). */
export type AdminUserDetail = InferResponseType<(typeof api.v1.admin.users)[':id']['$get']>;

/** One of a user's org memberships. */
export type AdminMembership = AdminUserDetail['memberships'][number];

/** A page of orgs (`GET /v1/admin/orgs`): `{ items, total }`. */
export type AdminOrgPage = InferResponseType<typeof api.v1.admin.orgs.$get>;

/** A single org row in the admin org list / detail. */
export type AdminOrg = AdminOrgPage['items'][number];

/** A lifecycle hold (`POST /v1/admin/orgs/:id/holds`). */
export type AdminHold = InferResponseType<(typeof api.v1.admin.orgs)[':id']['holds']['$post']>;

/** The lifecycle pipeline board (`GET /v1/admin/lifecycle`). */
export type AdminLifecycleBoard = InferResponseType<typeof api.v1.admin.lifecycle.$get>;

/** A page of operator audit events (`GET /v1/admin/audit`). */
export type AdminAuditPage = InferResponseType<typeof api.v1.admin.audit.$get>;

/** A single operator audit-event row. */
export type AdminAuditEvent = AdminAuditPage['items'][number];

/** An impersonation session (`POST /v1/admin/impersonations`). */
export type AdminImpersonation = InferResponseType<typeof api.v1.admin.impersonations.$post>;
