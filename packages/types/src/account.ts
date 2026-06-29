/**
 * `@docket/types` — account end-of-life DTOs (export + deletion).
 *
 * @remarks
 * User-scoped surface backing the personal-workspace **Export data** and **Danger zone**
 * settings. Deletion is a recoverable 14-day grace flow (`pending_deletion`), mirroring the
 * org data-lifecycle on the account layer; export is asynchronous (a request is queued and
 * a download link is emailed when the archive is ready). Absent values are modelled as
 * `.nullable()` (never `.optional()`), so every field is always present in the wire shape.
 */
import { z } from 'zod';

/** Account end-of-life state (the account-level mirror of the org lifecycle). */
export const AccountDeletionState = z.enum(['active', 'pending_deletion']);
/** Account-deletion-state value. */
export type AccountDeletionState = z.infer<typeof AccountDeletionState>;

/** Status of one asynchronous personal-data export job. */
export const AccountExportStatus = z.enum(['pending', 'ready', 'failed', 'expired']);
/** Account-export-status value. */
export type AccountExportStatus = z.infer<typeof AccountExportStatus>;

/**
 * A shared organization the user must resolve before deleting their account.
 *
 * @remarks
 * The user is the *only* active owner of this shared (non-personal) org, so deleting their
 * account would orphan it. The UI guides them to transfer ownership or delete the org first;
 * the deletion endpoint refuses to schedule while any blocker remains.
 */
export const OwnershipBlocker = z
  .object({
    /** The blocking organization's id. */
    organizationId: z.string(),
    /** The organization's display name. */
    name: z.string(),
    /** How many members the organization has (always > 1 — a shared org). */
    memberCount: z.number().int(),
  })
  .meta({
    id: 'OwnershipBlocker',
    description: 'A shared org the user solely owns and must resolve before account deletion.',
  });
/** Ownership-blocker value. */
export type OwnershipBlocker = z.infer<typeof OwnershipBlocker>;

/**
 * The latest personal-data export's status (null when the user has never requested one).
 *
 * @remarks
 * `downloadUrl`/`readyAt`/`expiresAt` are populated only once `status === 'ready'`; they are
 * null while the export is `pending`, `failed`, or `expired`. The link stops being offered
 * after `expiresAt`.
 */
export const AccountExportOut = z
  .object({
    /** The export's stable id (its addressable resource id). */
    id: z.string(),
    /** Where the export is in its lifecycle. */
    status: AccountExportStatus,
    /** ISO-8601 instant the export was requested. */
    requestedAt: z.string(),
    /** ISO-8601 instant the archive became downloadable, when ready; else null. */
    readyAt: z.string().nullable(),
    /** ISO-8601 instant the download link stops being offered, when ready; else null. */
    expiresAt: z.string().nullable(),
    /** A fetchable URL for the generated archive, when ready; else null. */
    downloadUrl: z.string().nullable(),
  })
  .meta({ id: 'AccountExportOut', description: "The user's latest personal-data export status." });
/** Account-export value. */
export type AccountExportOut = z.infer<typeof AccountExportOut>;

/** The user's personal-data exports, newest first. */
export const AccountExportListOut = z.object({ items: z.array(AccountExportOut) }).meta({
  id: 'AccountExportListOut',
  description: "The user's personal-data exports, newest first.",
});
/** Account-export-list value. */
export type AccountExportListOut = z.infer<typeof AccountExportListOut>;

/**
 * The user's recovery-code (backup-code) status for the Security settings surface.
 *
 * @remarks
 * Derived server-side from the `twoFactor` plugin: `enabled` is whether recovery codes have been
 * generated, `remaining` is how many unused codes are left (codes are consumed one-per-recovery),
 * and `generatedAt` is when they were last (re)generated. The codes themselves are NEVER returned
 * here — only shown once at generation time. `remaining` is 0 and `generatedAt` is null whenever
 * `enabled` is false.
 */
export const RecoveryCodesStatusOut = z
  .object({
    /** Whether the user has generated recovery codes. */
    enabled: z.boolean(),
    /** How many unused recovery codes remain (0 when not enabled). */
    remaining: z.number().int(),
    /** ISO-8601 instant the codes were last (re)generated, or null when not enabled. */
    generatedAt: z.string().nullable(),
  })
  .meta({
    id: 'RecoveryCodesStatusOut',
    description: "The user's account-recovery (backup) code status.",
  });
/** Recovery-codes-status value. */
export type RecoveryCodesStatusOut = z.infer<typeof RecoveryCodesStatusOut>;

/**
 * Freshly generated recovery codes, returned exactly once by `POST /v1/me/recovery-codes`.
 *
 * @remarks
 * This is the ONLY response that ever carries the plaintext codes — they are shown to the user
 * once at generation and are never retrievable again (the status read returns only a count).
 * Generating replaces any previous set.
 */
export const RecoveryCodesOut = z
  .object({
    /** The plaintext recovery codes, to display/save once. */
    codes: z.array(z.string()),
  })
  .meta({ id: 'RecoveryCodesOut', description: 'Freshly generated recovery codes (shown once).' });
/** Recovery-codes value. */
export type RecoveryCodesOut = z.infer<typeof RecoveryCodesOut>;

/**
 * The account end-of-life status powering the Danger zone + Export surfaces in one read.
 */
export const AccountStatusOut = z
  .object({
    /** Whether the account is `active` or scheduled for deletion (`pending_deletion`). */
    deletionState: AccountDeletionState,
    /** ISO-8601 instant deletion was scheduled, when pending; else null. */
    deletionRequestedAt: z.string().nullable(),
    /** ISO-8601 instant the grace window closes and the purge runs, when pending; else null. */
    deleteAfterAt: z.string().nullable(),
    /** Shared orgs the user solely owns that block deletion until resolved (empty when none). */
    blockers: z.array(OwnershipBlocker),
    /** The latest export job, or null if the user has never requested one. */
    export: AccountExportOut.nullable(),
  })
  .meta({ id: 'AccountStatusOut', description: "The user's account end-of-life status." });
/** Account-status value. */
export type AccountStatusOut = z.infer<typeof AccountStatusOut>;
