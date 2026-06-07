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
export const LifecycleState = z.enum([
  'trialing',
  'active',
  'past_due',
  'export_window',
  'pending_deletion',
  'deleted',
]);
/** Validated lifecycle-state value. */
export type LifecycleState = z.infer<typeof LifecycleState>;

/** The staff tier union mirrored from the schema enum. */
export const StaffRoleDto = z.enum(['support', 'finance', 'superadmin']);
/** Validated staff-tier value. */
export type StaffRoleDto = z.infer<typeof StaffRoleDto>;

/** Query params for the paginated, searchable user list. */
export const AdminUserListQuery = z.object({
  /** Case-insensitive substring matched against name + email. */
  search: z.string().optional(),
  /** Page size, 1..100 (default 50). */
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /** Number of rows to skip (offset pagination, default 0). */
  offset: z.coerce.number().int().min(0).default(0),
});
/** Validated user-list query value. */
export type AdminUserListQuery = z.infer<typeof AdminUserListQuery>;

/** A user row in the admin user list. */
export const AdminUserOut = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  createdAt: z.string(),
});
/** Validated admin-user value. */
export type AdminUserOut = z.infer<typeof AdminUserOut>;

/** A page of users with the total matched count for offset pagination. */
export const AdminUserPage = z.object({
  items: z.array(AdminUserOut),
  total: z.number().int(),
});
/** Validated admin-user-page value. */
export type AdminUserPage = z.infer<typeof AdminUserPage>;

/** One of a user's org memberships (the org + the user's actor/role within it). */
export const AdminMembershipOut = z.object({
  organizationId: z.string(),
  organizationName: z.string(),
  organizationSlug: z.string(),
  lifecycleState: LifecycleState,
  actorId: z.string(),
  roleId: z.string().nullable(),
});
/** Validated membership value. */
export type AdminMembershipOut = z.infer<typeof AdminMembershipOut>;

/** A user plus their memberships across every org (the user detail screen). */
export const AdminUserDetail = z.object({
  user: AdminUserOut,
  memberships: z.array(AdminMembershipOut),
});
/** Validated user-detail value. */
export type AdminUserDetail = z.infer<typeof AdminUserDetail>;

/** Query params for the paginated, lifecycle-filterable org list. */
export const AdminOrgListQuery = z.object({
  /** Optional substring matched against org name + slug. */
  search: z.string().optional(),
  /** Optional exact lifecycle-state filter. */
  lifecycleState: LifecycleState.optional(),
  /** Page size, 1..100 (default 50). */
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /** Number of rows to skip (default 0). */
  offset: z.coerce.number().int().min(0).default(0),
});
/** Validated org-list query value. */
export type AdminOrgListQuery = z.infer<typeof AdminOrgListQuery>;

/** An org row in the admin org list / detail. */
export const AdminOrgOut = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  isPersonal: z.boolean(),
  lifecycleState: LifecycleState,
  exportReadyAt: z.string().nullable(),
  deleteAfterAt: z.string().nullable(),
  createdAt: z.string(),
});
/** Validated admin-org value. */
export type AdminOrgOut = z.infer<typeof AdminOrgOut>;

/** A page of orgs with the total matched count for offset pagination. */
export const AdminOrgPage = z.object({
  items: z.array(AdminOrgOut),
  total: z.number().int(),
});
/** Validated admin-org-page value. */
export type AdminOrgPage = z.infer<typeof AdminOrgPage>;

/** An active (un-released) lifecycle hold on an org. */
export const AdminHoldOut = z.object({
  id: z.string(),
  organizationId: z.string(),
  reason: z.string(),
  placedBy: z.string().nullable(),
  createdAt: z.string(),
  releasedAt: z.string().nullable(),
});
/** Validated hold value. */
export type AdminHoldOut = z.infer<typeof AdminHoldOut>;

/** One lifecycle-board column: a state and the orgs currently in it. */
export const AdminLifecycleColumn = z.object({
  lifecycleState: LifecycleState,
  orgs: z.array(AdminOrgOut),
});
/** Validated lifecycle-column value. */
export type AdminLifecycleColumn = z.infer<typeof AdminLifecycleColumn>;

/** The lifecycle pipeline board: one column per lifecycle state. */
export const AdminLifecycleBoard = z.object({
  columns: z.array(AdminLifecycleColumn),
});
/** Validated lifecycle-board value. */
export type AdminLifecycleBoard = z.infer<typeof AdminLifecycleBoard>;

/** Body for placing a lifecycle hold (a free-text reason is required). */
export const PlaceHoldBody = z.object({ reason: z.string().min(1) });
/** Validated place-hold body. */
export type PlaceHoldBody = z.infer<typeof PlaceHoldBody>;

/** Body for extending an org's trial by a number of days. */
export const ExtendTrialBody = z.object({ days: z.coerce.number().int().min(1).max(365) });
/** Validated extend-trial body. */
export type ExtendTrialBody = z.infer<typeof ExtendTrialBody>;

/** Body for forcing an org's lifecycle state directly. */
export const SetLifecycleBody = z.object({ lifecycleState: LifecycleState });
/** Validated set-lifecycle body. */
export type SetLifecycleBody = z.infer<typeof SetLifecycleBody>;

/** Body for starting a time-boxed impersonation (target + reason + optional TTL). */
export const StartImpersonationBody = z.object({
  targetUserId: z.string().min(1),
  reason: z.string().min(1),
  /** Session lifetime in minutes, 1..480 (default 60). */
  ttlMinutes: z.coerce.number().int().min(1).max(480).default(60),
});
/** Validated start-impersonation body. */
export type StartImpersonationBody = z.infer<typeof StartImpersonationBody>;

/** An impersonation session record. */
export const AdminImpersonationOut = z.object({
  id: z.string(),
  staffUserId: z.string(),
  targetUserId: z.string(),
  reason: z.string(),
  startedAt: z.string(),
  expiresAt: z.string(),
  endedAt: z.string().nullable(),
});
/** Validated impersonation value. */
export type AdminImpersonationOut = z.infer<typeof AdminImpersonationOut>;

/** Query params for the operator audit feed (superadmin-only; staff + type filterable). */
export const AdminAuditQuery = z.object({
  /** Optional exact filter on the acting staff-user id. */
  staffUserId: z.string().optional(),
  /** Optional exact filter on the audit-event type (e.g. `billing.reactivated`). */
  type: z.string().optional(),
  /** Page size, 1..200 (default 50). */
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** Number of rows to skip (default 0). */
  offset: z.coerce.number().int().min(0).default(0),
});
/** Validated audit-feed query value. */
export type AdminAuditQuery = z.infer<typeof AdminAuditQuery>;

/** An operator audit-event row in the feed. */
export const AdminAuditOut = z.object({
  id: z.string(),
  staffUserId: z.string().nullable(),
  type: z.string(),
  subjectType: z.string(),
  subjectId: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});
/** Validated audit-event value. */
export type AdminAuditOut = z.infer<typeof AdminAuditOut>;

/** A page of operator audit events. */
export const AdminAuditPage = z.object({ items: z.array(AdminAuditOut) });
/** Validated audit-page value. */
export type AdminAuditPage = z.infer<typeof AdminAuditPage>;

/** One lifecycle-state bucket with its org count, for the metrics dashboard. */
export const AdminLifecycleCount = z.object({
  lifecycleState: LifecycleState,
  count: z.number().int(),
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
  /** Agent sessions currently parked in `awaiting_approval`. */
  stuckApprovals: z.number().int(),
  /** Agent sessions in the `failed` terminal state. */
  agentErrors: z.number().int(),
  /** Total agent sessions ever created (the volume signal). */
  agentVolume: z.number().int(),
  /** Un-released lifecycle holds currently pausing the delete pipeline. */
  activeHolds: z.number().int(),
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
  totalUsers: z.number().int(),
  totalOrgs: z.number().int(),
  orgsByLifecycle: z.array(AdminLifecycleCount),
  queues: AdminQueues,
});
/** Validated metrics value. */
export type AdminMetricsOut = z.infer<typeof AdminMetricsOut>;

/** Query params for the paginated staff-user list (superadmin-only). */
export const AdminStaffListQuery = z.object({
  /** Page size, 1..100 (default 50). */
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /** Number of rows to skip (default 0). */
  offset: z.coerce.number().int().min(0).default(0),
});
/** Validated staff-list query value. */
export type AdminStaffListQuery = z.infer<typeof AdminStaffListQuery>;

/** A staff-user row (the operator, its underlying user, and its tier). */
export const AdminStaffOut = z.object({
  id: z.string(),
  userId: z.string(),
  role: StaffRoleDto,
  userName: z.string(),
  userEmail: z.string(),
  createdAt: z.string(),
});
/** Validated staff-user value. */
export type AdminStaffOut = z.infer<typeof AdminStaffOut>;

/** A page of staff users with the total count for offset pagination. */
export const AdminStaffPage = z.object({
  items: z.array(AdminStaffOut),
  total: z.number().int(),
});
/** Validated staff-page value. */
export type AdminStaffPage = z.infer<typeof AdminStaffPage>;

/** Body for granting (or re-granting) a user a staff tier. */
export const CreateStaffBody = z.object({
  /** The global user id to promote to staff. */
  userId: z.string().min(1),
  /** The tier to grant. */
  role: StaffRoleDto,
});
/** Validated create-staff body. */
export type CreateStaffBody = z.infer<typeof CreateStaffBody>;
