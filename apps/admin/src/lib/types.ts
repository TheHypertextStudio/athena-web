import type { InferResponseType } from 'hono/client';

import type { api, productApi } from '@/lib/api';

/**
 * The operator dashboard metrics (`GET /admin/metrics`).
 *
 * @remarks
 * Derived from the typed RPC client rather than importing the API's internal DTO modules:
 * `@docket/api/rpc-contract` exposes the `AdminAppType` transport contract, so every admin
 * shape is inferred from the corresponding route's success response. This keeps the admin types
 * in lockstep with the server contract at compile time.
 */
export type AdminMetrics = InferResponseType<typeof api.admin.metrics.$get>;

/** A page of users (`GET /admin/users`): `{ items, total }`. */
export type AdminUserPage = InferResponseType<typeof api.admin.users.$get>;

/** A single user row in the admin user list. */
export type AdminUser = AdminUserPage['items'][number];

/** A user plus their cross-org memberships (`GET /admin/users/:id`). */
export type AdminUserDetail = InferResponseType<(typeof api.admin.users)[':id']['$get']>;

/** A page of service operators, as `GET /admin/staff` returns it. */
export type AdminStaffPage = InferResponseType<typeof api.admin.staff.$get>;

/** One service operator on the roster. */
export type AdminStaff = AdminStaffPage['items'][number];

/** One of a user's org memberships. */
export type AdminMembership = AdminUserDetail['memberships'][number];

/** A page of orgs (`GET /admin/orgs`): `{ items, total }`. */
export type AdminOrgPage = InferResponseType<typeof api.admin.orgs.$get>;

/** A single org row in the admin org list / detail. */
export type AdminOrg = AdminOrgPage['items'][number];

/** Billing-provider and discount diagnostics for one organization. */
export type AdminOrgBillingState = InferResponseType<
  (typeof api.admin.orgs)[':id']['billing-state']['$get']
>;

/** A lifecycle hold (`POST /admin/orgs/:id/holds`). */
export type AdminHold = InferResponseType<(typeof api.admin.orgs)[':id']['holds']['$post']>;

/** The legacy organization-retention board (`GET /admin/lifecycle`). */
export type AdminLifecycleBoard = InferResponseType<typeof api.admin.lifecycle.$get>;

/** A page of operator audit events (`GET /admin/audit`). */
export type AdminAuditPage = InferResponseType<typeof api.admin.audit.$get>;

/** A single operator audit-event row. */
export type AdminAuditEvent = AdminAuditPage['items'][number];

/** An impersonation session (`POST /admin/impersonations`). */
export type AdminImpersonation = InferResponseType<typeof api.admin.impersonations.$post>;

/** Staff notification-intent list (`GET /admin/notifications`). */
export type AdminNotificationPage = InferResponseType<typeof api.admin.notifications.$get>;

/** One notification intent in the staff announcement console. */
export type AdminNotificationIntent = AdminNotificationPage['items'][number];

/** Staff audience estimate (`GET /admin/notifications/:id/estimate`). */
export type AdminNotificationEstimate = InferResponseType<
  (typeof api.admin.notifications)[':id']['estimate']['$get']
>;

/** Staff channel preview (`GET /admin/notifications/:id/preview`). */
export type AdminNotificationPreview = InferResponseType<
  (typeof api.admin.notifications)[':id']['preview']['$get']
>;

/** Staff notification audit page (`GET /admin/notifications/:id/audit`). */
export type AdminNotificationAuditPage = InferResponseType<
  (typeof api.admin.notifications)[':id']['audit']['$get']
>;

/** Staff notification inbound-event page (`GET /admin/notifications/:id/inbound-events`). */
export type AdminNotificationInboundPage = InferResponseType<
  (typeof api.admin.notifications)[':id']['inbound-events']['$get']
>;

/** Notification delivery page (`GET /v1/notifications/:id/deliveries`). */
export type NotificationDeliveryPage = InferResponseType<
  (typeof productApi.v1.notifications)[':id']['deliveries']['$get']
>;
