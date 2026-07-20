/**
 * `@docket/api` — service-admin (operator back-office) DTOs.
 *
 * @remarks
 * Zod request/response shapes for the staff-gated `/v1/admin/*` router. These are
 * plain (un-branded) schemas — the admin surface is operator-facing tooling, not the
 * tenant RPC contract, so it uses raw string ids and the org lifecycle string union
 * directly. Validated through {@link ok} / `zJson` / `zQuery` like every other route.
 */
import { z } from 'zod';

/** The org data-lifecycle state union mirrored from the schema enum. */
export const LifecycleState = z
  .enum(['trialing', 'active', 'past_due', 'export_window', 'pending_deletion', 'deleted'])
  .describe(
    "An organization's position in the billing-driven data-retention pipeline. `trialing`: in-trial, full access. `active`: paying, healthy subscription. `past_due`: a payment failed — a soft warning state where the org stays usable. `export_window`: the trial ended or payment terminally lapsed — a 14-day grace period where data stays readable/exportable before deletion. `pending_deletion`: the grace period elapsed; the org is staged for deletion (dwells here at least one cron-sweep cycle). `deleted`: the lifecycle terminus authorizing the data purge.",
  );
/** Validated lifecycle-state value. */
export type LifecycleState = z.infer<typeof LifecycleState>;

/** The staff tier union mirrored from the schema enum. */
export const StaffRoleDto = z
  .enum(['support', 'finance', 'superadmin'])
  .describe(
    'A Docket operator tier, in ascending privilege (`support` < `finance` < `superadmin`). `support` can read the back-office and impersonate end-users; `finance` adds billing/lifecycle actions (extend-trial, reactivate, set-lifecycle); `superadmin` adds the audit feed and staff management, and outranks every lower tier.',
  );
/** Validated staff-tier value. */
export type StaffRoleDto = z.infer<typeof StaffRoleDto>;

/** Query params for the paginated, searchable user list. */
export const AdminUserListQuery = z.object({
  search: z
    .string()
    .optional()
    .describe(
      'Case-insensitive substring matched against the user name OR email; omit to list all.',
    ),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(50)
    .describe('Page size, 1..100 (default 50).'),
  offset: z.coerce
    .number()
    .int()
    .min(0)
    .default(0)
    .describe('Number of rows to skip (offset pagination, default 0).'),
});
/** Validated user-list query value. */
export type AdminUserListQuery = z.infer<typeof AdminUserListQuery>;

/** A user row in the admin user list. */
export const AdminUserOut = z.object({
  id: z.string().describe('The global user account id.'),
  name: z.string().describe('The display name on the account.'),
  email: z.string().describe('The account email (also the login identifier).'),
  emailVerified: z.boolean().describe('Whether the account has confirmed ownership of its email.'),
  createdAt: z.string().describe('Account creation timestamp (ISO-8601).'),
});
/** Validated admin-user value. */
export type AdminUserOut = z.infer<typeof AdminUserOut>;

/** A page of users with the total matched count for offset pagination. */
export const AdminUserPage = z.object({
  items: z.array(AdminUserOut).describe('The users on this page, newest first.'),
  total: z.number().int().describe('Total users matching the (optional) search, across all pages.'),
});
/** Validated admin-user-page value. */
export type AdminUserPage = z.infer<typeof AdminUserPage>;

/** One of a user's org memberships (the org + the user's actor/role within it). */
export const AdminMembershipOut = z.object({
  organizationId: z.string().describe('Id of the org the user belongs to.'),
  organizationName: z.string().describe('Display name of that org.'),
  organizationSlug: z.string().describe('URL slug of that org.'),
  lifecycleState: LifecycleState.describe("That org's current data-lifecycle state."),
  actorId: z.string().describe("The user's actor id within this org (its membership identity)."),
  roleId: z
    .string()
    .nullable()
    .describe("The role assigned to the user's actor in this org, or null when it holds no role."),
});
/** Validated membership value. */
export type AdminMembershipOut = z.infer<typeof AdminMembershipOut>;

/** A user plus their memberships across every org (the user detail screen). */
export const AdminUserDetail = z.object({
  user: AdminUserOut.describe('The user account.'),
  memberships: z
    .array(AdminMembershipOut)
    .describe("Every org the user is a human member of, with the user's actor + role in each."),
});
/** Validated user-detail value. */
export type AdminUserDetail = z.infer<typeof AdminUserDetail>;

/** Query params for the paginated, lifecycle-filterable org list. */
export const AdminOrgListQuery = z.object({
  search: z
    .string()
    .optional()
    .describe('Case-insensitive substring matched against the org name OR slug; omit to list all.'),
  lifecycleState: LifecycleState.optional().describe(
    'Optional exact data-lifecycle-state filter; combines with `search` via AND.',
  ),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(50)
    .describe('Page size, 1..100 (default 50).'),
  offset: z.coerce
    .number()
    .int()
    .min(0)
    .default(0)
    .describe('Number of rows to skip (offset pagination, default 0).'),
});
/** Validated org-list query value. */
export type AdminOrgListQuery = z.infer<typeof AdminOrgListQuery>;

/** An org row in the admin org list / detail. */
export const AdminOrgOut = z.object({
  id: z.string().describe('The organization id.'),
  name: z.string().describe('Display name of the org.'),
  slug: z.string().describe('URL slug of the org (unique).'),
  isPersonal: z
    .boolean()
    .describe('True for a single-member personal workspace, which cannot accept invites.'),
  lifecycleState: LifecycleState.describe("The org's current data-lifecycle state."),
  exportReadyAt: z
    .string()
    .nullable()
    .describe(
      'When the export window opened (ISO-8601), or null when the org is not in/after the window. Set on entry to `export_window`; cleared on reactivation and on final deletion.',
    ),
  deleteAfterAt: z
    .string()
    .nullable()
    .describe(
      'When the deletion sweep may advance this org (ISO-8601 = export-window open + 14 days), or null when no deletion is scheduled.',
    ),
  isBillingExempt: z
    .boolean()
    .describe(
      'True when a staff-granted billing exemption is currently active on this org — it bypasses the lifecycle-state entitlement gate entirely, independent of Stripe.',
    ),
  createdAt: z.string().describe('Org creation timestamp (ISO-8601).'),
});
/** Validated admin-org value. */
export type AdminOrgOut = z.infer<typeof AdminOrgOut>;

/** A page of orgs with the total matched count for offset pagination. */
export const AdminOrgPage = z.object({
  items: z.array(AdminOrgOut).describe('The orgs on this page, newest first.'),
  total: z.number().int().describe('Total orgs matching the filters, across all pages.'),
});
/** Validated admin-org-page value. */
export type AdminOrgPage = z.infer<typeof AdminOrgPage>;

/** An active (un-released) lifecycle hold on an org. */
export const AdminHoldOut = z.object({
  id: z.string().describe('The lifecycle-hold id.'),
  organizationId: z.string().describe('The org the hold pauses.'),
  reason: z.string().describe('The required free-text justification for the hold.'),
  placedBy: z
    .string()
    .nullable()
    .describe('Staff-user id of the operator who placed the hold, or null if unattributed.'),
  createdAt: z.string().describe('When the hold was placed (ISO-8601).'),
  releasedAt: z
    .string()
    .nullable()
    .describe('When the hold was released (ISO-8601), or null while still active.'),
});
/** Validated hold value. */
export type AdminHoldOut = z.infer<typeof AdminHoldOut>;

/** An active (un-revoked) billing exemption on an org. */
export const AdminBillingExemptionOut = z.object({
  id: z.string().describe('The billing-exemption id.'),
  organizationId: z.string().describe('The org this exemption applies to.'),
  reason: z.string().describe('The required free-text justification for the grant.'),
  grantedBy: z
    .string()
    .nullable()
    .describe('Staff-user id of the operator who granted the exemption, or null if unattributed.'),
  createdAt: z.string().describe('When the exemption was granted (ISO-8601).'),
  revokedBy: z
    .string()
    .nullable()
    .describe(
      'Staff-user id of the operator who revoked the exemption, or null while still active.',
    ),
  revokedAt: z
    .string()
    .nullable()
    .describe('When the exemption was revoked (ISO-8601), or null while still active.'),
});
/** Validated billing-exemption value. */
export type AdminBillingExemptionOut = z.infer<typeof AdminBillingExemptionOut>;

/** Body for granting a billing exemption (a free-text reason is required). */
export const GrantExemptionBody = z.object({
  reason: z
    .string()
    .min(1)
    .describe('Required free-text justification, recorded on the grant and in the audit event.'),
});
/** Validated grant-exemption body. */
export type GrantExemptionBody = z.infer<typeof GrantExemptionBody>;

/** One lifecycle-board column: a state and the orgs currently in it. */
export const AdminLifecycleColumn = z.object({
  lifecycleState: LifecycleState.describe('The state this column represents.'),
  orgs: z.array(AdminOrgOut).describe('The orgs currently in this state, newest first.'),
});
/** Validated lifecycle-column value. */
export type AdminLifecycleColumn = z.infer<typeof AdminLifecycleColumn>;

/** The lifecycle pipeline board: one column per lifecycle state. */
export const AdminLifecycleBoard = z.object({
  columns: z
    .array(AdminLifecycleColumn)
    .describe(
      'One column per lifecycle state, in fixed pipeline order (`trialing → active → past_due → export_window → pending_deletion → deleted`); empty columns are still present.',
    ),
});
/** Validated lifecycle-board value. */
export type AdminLifecycleBoard = z.infer<typeof AdminLifecycleBoard>;

/** Body for placing a lifecycle hold (a free-text reason is required). */
export const PlaceHoldBody = z.object({
  reason: z
    .string()
    .min(1)
    .describe('Required free-text justification, recorded on the hold and in the audit event.'),
});
/** Validated place-hold body. */
export type PlaceHoldBody = z.infer<typeof PlaceHoldBody>;

/** Body for extending an org's trial by a number of days. */
export const ExtendTrialBody = z.object({
  days: z.coerce
    .number()
    .int()
    .min(1)
    .max(365)
    .describe(
      'Number of trial days to grant (1..365), recorded as operator intent in the audit event; the action resets the org to `trialing` and clears the export/delete timers.',
    ),
});
/** Validated extend-trial body. */
export type ExtendTrialBody = z.infer<typeof ExtendTrialBody>;

/** Body for forcing an org's lifecycle state directly. */
export const SetLifecycleBody = z.object({
  lifecycleState: LifecycleState.describe(
    'The target state to force the org into; routed through the real transition logic so export/delete timers stay consistent.',
  ),
});
/** Validated set-lifecycle body. */
export type SetLifecycleBody = z.infer<typeof SetLifecycleBody>;

/** Body for starting a time-boxed impersonation (target + reason + optional TTL). */
export const StartImpersonationBody = z.object({
  targetUserId: z.string().min(1).describe('The end-user account the operator wants to act as.'),
  reason: z
    .string()
    .min(1)
    .describe('Required justification for the impersonation, recorded in the audit event.'),
  ttlMinutes: z.coerce
    .number()
    .int()
    .min(1)
    .max(480)
    .default(60)
    .describe('Session lifetime in minutes, 1..480 (default 60); sets `expiresAt = now + ttl`.'),
});
/** Validated start-impersonation body. */
export type StartImpersonationBody = z.infer<typeof StartImpersonationBody>;

/** An impersonation session record. */
export const AdminImpersonationOut = z.object({
  id: z.string().describe('The impersonation-session id.'),
  staffUserId: z.string().describe('Staff-user id of the operator who opened the session.'),
  targetUserId: z.string().describe('The end-user account being impersonated.'),
  reason: z.string().describe('The justification supplied when the session was started.'),
  startedAt: z.string().describe('When the session opened (ISO-8601).'),
  expiresAt: z.string().describe('When the session auto-expires (ISO-8601 = startedAt + TTL).'),
  endedAt: z
    .string()
    .nullable()
    .describe('When the session was explicitly ended (ISO-8601), or null while still active.'),
});
/** Validated impersonation value. */
export type AdminImpersonationOut = z.infer<typeof AdminImpersonationOut>;

/** Query params for the operator audit feed (superadmin-only; staff + type filterable). */
export const AdminAuditQuery = z.object({
  staffUserId: z
    .string()
    .optional()
    .describe('Optional exact filter on the acting operator (staff-user id).'),
  type: z
    .string()
    .optional()
    .describe(
      'Optional exact filter on the audit-event type (e.g. `billing.reactivated`, `lifecycle_hold.placed`, `staff.granted`).',
    ),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(200)
    .default(50)
    .describe('Page size, 1..200 (default 50).'),
  offset: z.coerce
    .number()
    .int()
    .min(0)
    .default(0)
    .describe('Number of rows to skip (offset pagination, default 0).'),
});
/** Validated audit-feed query value. */
export type AdminAuditQuery = z.infer<typeof AdminAuditQuery>;

/** An operator audit-event row in the feed. */
export const AdminAuditOut = z.object({
  id: z.string().describe('The audit-event id.'),
  staffUserId: z
    .string()
    .nullable()
    .describe('Staff-user id of the operator who performed the action, or null if unattributed.'),
  type: z
    .string()
    .describe(
      'The action type (e.g. `impersonation.started`, `lifecycle_hold.released`, `billing.trial_extended`, `lifecycle.state_set`, `staff.revoked`).',
    ),
  subjectType: z
    .string()
    .describe('The kind of entity acted on (e.g. `organization`, `actor`, `staff_user`).'),
  subjectId: z.string().describe('Id of the specific entity acted on.'),
  metadata: z
    .record(z.string(), z.unknown())
    .describe('Free-form per-event detail (e.g. previous/next state, hold id, reason, TTL).'),
  createdAt: z.string().describe('When the action occurred (ISO-8601).'),
});
/** Validated audit-event value. */
export type AdminAuditOut = z.infer<typeof AdminAuditOut>;

/** A page of operator audit events. */
export const AdminAuditPage = z.object({
  items: z.array(AdminAuditOut).describe('The audit events on this page, newest first.'),
});
/** Validated audit-page value. */
export type AdminAuditPage = z.infer<typeof AdminAuditPage>;

/** One lifecycle-state bucket with its org count, for the metrics dashboard. */
export const AdminLifecycleCount = z.object({
  lifecycleState: LifecycleState.describe('The lifecycle state being counted.'),
  count: z.number().int().describe('Number of orgs currently in this state (0 when empty).'),
});
/** Validated lifecycle-count value. */
export type AdminLifecycleCount = z.infer<typeof AdminLifecycleCount>;

/**
 * The operator-queue health signals (mvp-plan §8.9: aggregate signals only).
 *
 * @remarks
 * Deliberately high-level — never session contents. `stuckApprovals` counts agent
 * sessions parked in `awaiting_approval` (work blocked on a human decision);
 * `agentErrors` counts `failed` sessions; `agentVolume` is the total session count;
 * `activeHolds` is the number of un-released lifecycle holds pausing the delete sweep.
 */
export const AdminQueues = z.object({
  stuckApprovals: z
    .number()
    .int()
    .describe('Agent sessions parked in `awaiting_approval` — work blocked on a human decision.'),
  agentErrors: z.number().int().describe('Agent sessions in the `failed` terminal state.'),
  agentVolume: z.number().int().describe('Total agent sessions ever created (the volume signal).'),
  activeHolds: z
    .number()
    .int()
    .describe('Un-released lifecycle holds currently pausing the delete pipeline.'),
});
/** Validated operator-queue value. */
export type AdminQueues = z.infer<typeof AdminQueues>;

/**
 * The operator home-dashboard metrics: split counts + queues (mvp-plan §8.9).
 *
 * @remarks
 * `counts` carries the steady-state totals (users, orgs, orgs-by-lifecycle); `queues`
 * carries the actionable health signals the operator triages from the home screen.
 */
export const AdminMetricsOut = z.object({
  totalUsers: z.number().int().describe('Total end-user accounts across all orgs.'),
  totalOrgs: z.number().int().describe('Total organizations (tenants).'),
  orgsByLifecycle: z
    .array(AdminLifecycleCount)
    .describe('Org counts bucketed by lifecycle state, in fixed pipeline order.'),
  queues: AdminQueues.describe('Actionable operator queue-health signals.'),
});
/** Validated metrics value. */
export type AdminMetricsOut = z.infer<typeof AdminMetricsOut>;

/** Query params for the paginated staff-user list (superadmin-only). */
export const AdminStaffListQuery = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(50)
    .describe('Page size, 1..100 (default 50).'),
  offset: z.coerce
    .number()
    .int()
    .min(0)
    .default(0)
    .describe('Number of rows to skip (offset pagination, default 0).'),
});
/** Validated staff-list query value. */
export type AdminStaffListQuery = z.infer<typeof AdminStaffListQuery>;

/** A staff-user row (the operator, its underlying user, and its tier). */
export const AdminStaffOut = z.object({
  id: z.string().describe('The staff-user id (distinct from the underlying account id).'),
  userId: z.string().describe('The underlying global user account promoted to staff.'),
  role: StaffRoleDto.describe('The operator tier granted to this staff member.'),
  userName: z
    .string()
    .describe('Display name from the joined user account (blank on a revoke response).'),
  userEmail: z
    .string()
    .describe('Email from the joined user account (blank on a revoke response).'),
  createdAt: z.string().describe('When staff access was granted (ISO-8601).'),
});
/** Validated staff-user value. */
export type AdminStaffOut = z.infer<typeof AdminStaffOut>;

/** A page of staff users with the total count for offset pagination. */
export const AdminStaffPage = z.object({
  items: z.array(AdminStaffOut).describe('The staff members on this page, newest first.'),
  total: z.number().int().describe('Total staff members, across all pages.'),
});
/** Validated staff-page value. */
export type AdminStaffPage = z.infer<typeof AdminStaffPage>;

/** Body for granting (or re-granting) a user a staff tier. */
export const CreateStaffBody = z.object({
  userId: z
    .string()
    .min(1)
    .describe('The global user id to promote to staff (must be an existing, non-staff account).'),
  role: StaffRoleDto.describe('The operator tier to grant.'),
});
/** Validated create-staff body. */
export type CreateStaffBody = z.infer<typeof CreateStaffBody>;
