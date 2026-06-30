/**
 * `@docket/api` — account end-of-life router (mounted at `/v1/me/account`).
 *
 * @remarks
 * The user-scoped surface behind the personal-workspace **Export data** + **Danger zone**
 * settings. Reads the account status (deletion state, ownership blockers, latest export),
 * queues an asynchronous data export, and schedules / cancels a recoverable account deletion.
 * All routes require an active session ({@link requireSession}); scheduling deletion additionally
 * requires a freshly re-authenticated session ({@link requireFreshSession}) and no unresolved
 * sole-owner shared orgs. The heavy work (export generation, the final purge) runs in the cron
 * sweeps — these routes only record intent and send the confirming email.
 */
import { accountExport, db, hub } from '@docket/db';
import {
  type AccountExportStatus,
  AccountExportListOut,
  AccountExportOut,
  AccountStatusOut,
  type OwnershipBlocker,
} from '@docket/types';
import { and, desc, eq } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';

import { findOwnershipBlockers } from '../account/blockers';
import { exportFilename } from '../account/archive';
import { deletionCanceledEmail, deletionScheduledEmail } from '../account/emails';
import { cancelAccountDeletion, scheduleAccountDeletion } from '../account/lifecycle';
import { getContainer } from '../container';
import type { AppEnv, AuthSession } from '../context';
import { env } from '../env';
import {
  AuthError,
  ConflictError,
  DeletionBlockedError,
  NotFoundError,
  ReauthRequiredError,
} from '../error';
import { ok } from '../lib/ok';
import { one } from '../lib/one';
import { apiDoc, describeRoute } from '../lib/openapi-route';

/** Like {@link ok} but with an explicit status (e.g. 201 Created, 202 Accepted). */
function okWith<T extends z.ZodType>(
  c: Context<AppEnv>,
  schema: T,
  data: z.input<T>,
  status: ContentfulStatusCode,
) {
  return c.json(schema.parse(data), status);
}

/** Seconds a session stays "fresh" for high-risk actions (account deletion). */
const FRESH_SESSION_MAX_AGE_S = 300;

/** Require an active session; throw 401 if none. */
function requireSession(c: Context<AppEnv>): NonNullable<AuthSession> {
  const session = c.get('session');
  if (!session?.user.id) throw new AuthError('Authentication required.');
  return session;
}

/**
 * Require a freshly re-authenticated session (step-up) for a high-risk action.
 *
 * @remarks
 * The session must have been created within {@link FRESH_SESSION_MAX_AGE_S}. A passkey
 * re-verification on the client mints a new session, resetting `createdAt`; an older session
 * gets a `reauth_required` 401 so the client can re-challenge and retry.
 */
function requireFreshSession(session: NonNullable<AuthSession>): void {
  const ageMs = Date.now() - new Date(session.session.createdAt).getTime();
  if (ageMs > FRESH_SESSION_MAX_AGE_S * 1000) {
    throw new ReauthRequiredError('Please re-verify your passkey to continue.');
  }
}

/** Serialize an export row into the wire shape (resolving the download URL when ready). */
function toExportOut(row: typeof accountExport.$inferSelect): z.input<typeof AccountExportOut> {
  const ready = row.status === 'ready' && row.blobKey;
  return {
    id: row.id,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    readyAt: row.readyAt ? row.readyAt.toISOString() : null,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    // The RESTful binary sub-resource of this export. Relative + same-origin to the web app so the
    // browser carries the session cookie through Next's `/v1` proxy (an absolute API-origin URL is
    // cross-origin and arrives unauthenticated → 401).
    downloadUrl: ready ? `/v1/me/account/exports/${row.id}/file` : null,
  };
}

/** The user's latest export (or null when they've never requested one). */
async function latestExport(userId: string): Promise<z.input<typeof AccountExportOut> | null> {
  const row = await one(
    db
      .select()
      .from(accountExport)
      .where(eq(accountExport.userId, userId))
      .orderBy(desc(accountExport.requestedAt)),
  );
  return row ? toExportOut(row) : null;
}

/**
 * Build the full account end-of-life status for a user.
 *
 * @param userId - The user.
 * @param knownBlockers - Ownership blockers already computed by the caller (the deletion
 *   handler), reused to avoid a second membership scan; recomputed when omitted.
 */
async function loadStatus(
  userId: string,
  knownBlockers?: OwnershipBlocker[],
): Promise<z.input<typeof AccountStatusOut>> {
  const [h, blockers, exportStatus] = await Promise.all([
    one(
      db
        .select({
          deletionState: hub.deletionState,
          deletionRequestedAt: hub.deletionRequestedAt,
          deleteAfterAt: hub.deleteAfterAt,
        })
        .from(hub)
        .where(eq(hub.userId, userId)),
    ),
    knownBlockers ?? findOwnershipBlockers(db, userId),
    latestExport(userId),
  ]);
  return {
    deletionState: h?.deletionState ?? 'active',
    deletionRequestedAt: h?.deletionRequestedAt ? h.deletionRequestedAt.toISOString() : null,
    deleteAfterAt: h?.deleteAfterAt ? h.deleteAfterAt.toISOString() : null,
    blockers,
    export: exportStatus,
  };
}

/**
 * Queue a fresh export unless one is already pending (idempotent request).
 *
 * @returns the queued/pending export and whether a new one was created (for 201 vs 200).
 */
async function enqueueExport(
  userId: string,
): Promise<{ export: z.input<typeof AccountExportOut>; created: boolean }> {
  const pending = await one(
    db
      .select()
      .from(accountExport)
      .where(and(eq(accountExport.userId, userId), eq(accountExport.status, 'pending'))),
  );
  if (pending) return { export: toExportOut(pending), created: false };
  const [inserted] = await db.insert(accountExport).values({ userId }).returning();
  if (!inserted) throw new Error('Failed to queue export.');
  return { export: toExportOut(inserted), created: true };
}

/** Load one of the user's own export rows by id (404 candidate when absent). */
async function getExportRow(
  userId: string,
  exportId: string,
): Promise<typeof accountExport.$inferSelect | undefined> {
  return one(
    db
      .select()
      .from(accountExport)
      .where(and(eq(accountExport.id, exportId), eq(accountExport.userId, userId))),
  );
}

const meAccount = new Hono<AppEnv>()
  // The account resource: read its end-of-life status (deletion state, blockers, latest export).
  .get(
    '/',
    apiDoc({
      tag: 'Me',
      summary: 'Get account status',
      response: AccountStatusOut,
      description: `Return the caller's complete **account end-of-life status** in one read — the data behind the personal-workspace *Export data* and *Danger zone* settings. Reports the deletion state (\`active\` vs \`pending_deletion\`) with its \`deletionRequestedAt\`/\`deleteAfterAt\` timestamps, the set of **ownership blockers** (shared orgs the caller is the sole active owner of, which must be transferred or deleted before the account can be removed), and the caller's latest data export (status + download link when ready, else null).

Computed by scanning the caller's Hub deletion fields, recomputing ownership blockers, and loading the latest export — all in parallel. Read-only; session-only, no capability (no step-up needed just to view status). **401** when unauthenticated. Related: \`DELETE /me/account\` (schedule deletion), \`POST /me/account/reactivation\` (cancel it), \`GET /me/account/exports\`.`,
    }),
    async (c) => {
      const { user } = requireSession(c);
      return ok(c, AccountStatusOut, await loadStatus(user.id));
    },
  )
  // Deleting the account schedules a recoverable 14-day deletion. 202 Accepted — the request is
  // accepted but the purge is enacted later by the cron sweep (the grace window). Requires a fresh
  // session (step-up) and no sole-owner blockers (409 otherwise).
  .delete(
    '/',
    apiDoc({
      tag: 'Me',
      summary: 'Schedule account deletion',
      response: AccountStatusOut,
      status: 202,
      description: `Schedule a **recoverable, 14-day-grace** deletion of the caller's account, returning the updated account status. Responds **202 Accepted** because the request only *records intent*: the account flips to \`pending_deletion\` now, but the irreversible purge is enacted later by a cron sweep once the grace window (\`deleteAfterAt\`) closes — until then the deletion can be undone via \`POST /me/account/reactivation\`.

**Two gates must pass.** First, step-up: the action requires a **freshly re-authenticated session** (created within the last 5 minutes); a passkey re-verification on the client mints a new session, and a stale session is rejected with **401 \`reauth_required\`** so the client re-challenges and retries. Second, ownership: if the caller is the sole active owner of any shared org, the request is refused with **409 \`deletion_blocked\`** (the blocking orgs are listed in account status) — they must transfer ownership or delete those orgs first.

**Side effects** on success: marks the Hub \`pending_deletion\` with \`deleteAfterAt\`, automatically queues a fresh data export (so the user can grab everything before the purge), and emails a deletion-scheduled confirmation. Session-only otherwise (no capability). Related: \`POST /me/account/reactivation\`, \`GET /me/account\`.`,
    }),
    async (c) => {
      const session = requireSession(c);
      requireFreshSession(session);
      const { user } = session;

      const blockers = await findOwnershipBlockers(db, user.id);
      if (blockers.length > 0) throw new DeletionBlockedError();

      const now = new Date().toISOString();
      await scheduleAccountDeletion(db, user.id, now);
      // Offer a fresh export of everything before the data is purged.
      await enqueueExport(user.id);

      // Reuse the blockers already computed (empty here) so loadStatus doesn't re-scan.
      const status = await loadStatus(user.id, blockers);
      if (status.deleteAfterAt) {
        const email = deletionScheduledEmail({
          name: user.name,
          deleteAfterAt: status.deleteAfterAt,
        });
        await getContainer().mailer.send({ to: user.email, ...email });
      }
      return okWith(c, AccountStatusOut, status, 202);
    },
  )
  // Recover a scheduled deletion during its grace window (the inverse of DELETE /me/account).
  .post(
    '/reactivation',
    apiDoc({
      tag: 'Me',
      summary: 'Cancel account deletion',
      response: AccountStatusOut,
      description: `Recover an account that is scheduled for deletion — the inverse of \`DELETE /me/account\`. Modelled as creating a *reactivation* on the account resource. **Side effects:** clears the Hub's \`pending_deletion\` state (returning it to \`active\`, clearing \`deletionRequestedAt\`/\`deleteAfterAt\` so the cron purge will not run) and emails a deletion-canceled confirmation. Returns the refreshed account status.

Only effective during the grace window, before the cron sweep has purged the account. Unlike scheduling, cancellation does **not** require a fresh/step-up session — recovering access should be low-friction — but it does require an authenticated session (no capability). **401** when unauthenticated. Related: \`DELETE /me/account\`, \`GET /me/account\`.`,
    }),
    async (c) => {
      const { user } = requireSession(c);
      await cancelAccountDeletion(db, user.id);

      const email = deletionCanceledEmail({ name: user.name });
      await getContainer().mailer.send({ to: user.email, ...email });

      return ok(c, AccountStatusOut, await loadStatus(user.id));
    },
  )
  // Exports — an addressable sub-collection. (The binary sub-resource GET …/:id/file is mounted
  // separately outside the RPC contract; see meAccountExportDownload.)
  .get(
    '/exports',
    apiDoc({
      tag: 'Me',
      summary: 'List account exports',
      response: AccountExportListOut,
      description: `List the caller's **personal-data export** jobs, newest first. Each export is an asynchronous job that bundles the user's data into a downloadable ZIP archive; the list shows each job's lifecycle status (\`pending\`/\`ready\`/\`failed\`/\`expired\`), request/ready/expiry timestamps, and a \`downloadUrl\` that is populated only once the archive is \`ready\` (and stops being offered after it expires).

User-scoped to \`session.user.id\`; read-only; session-only, no capability. **401** when unauthenticated. Related: \`POST /me/account/exports\` to request one, \`GET /me/account/exports/:exportId\` for a single job, and the binary download at \`GET /me/account/exports/:exportId/file\`.`,
    }),
    async (c) => {
      const { user } = requireSession(c);
      const rows = await db
        .select()
        .from(accountExport)
        .where(eq(accountExport.userId, user.id))
        .orderBy(desc(accountExport.requestedAt));
      return ok(c, AccountExportListOut, { items: rows.map(toExportOut) });
    },
  )
  .post(
    '/exports',
    apiDoc({
      tag: 'Me',
      summary: 'Request an account export',
      response: AccountExportOut,
      status: 201,
      description: `Queue an asynchronous **personal-data export** and return the export job. **The request is idempotent / de-duplicated:** if the caller already has a \`pending\` export, that existing job is returned with **200 OK** and no new job is created; only when there is no pending job is a fresh one queued and returned with **201 Created**. Either way a \`Location\` header points at the new job's resource (\`/v1/me/account/exports/:id\`).

This route only *records intent* — the actual archive generation runs in a cron sweep, which flips the job to \`ready\` (with a download link) or \`failed\`. **Side effect:** inserts an \`accountExport\` row (when none pending). Session-only, no capability; **401** when unauthenticated. The same enqueue is triggered automatically when scheduling account deletion. Related: \`GET /me/account/exports\`, and the binary \`GET …/:exportId/file\`.`,
    }),
    async (c) => {
      const { user } = requireSession(c);
      const { export: created, created: isNew } = await enqueueExport(user.id);
      c.header('Location', `${env.API_URL}/v1/me/account/exports/${created.id}`);
      return okWith(c, AccountExportOut, created, isNew ? 201 : 200);
    },
  )
  .get(
    '/exports/:exportId',
    apiDoc({
      tag: 'Me',
      summary: 'Get an account export',
      response: AccountExportOut,
      description: `Fetch a single personal-data export job by \`:exportId\` — used to poll a queued export until it becomes \`ready\` (at which point \`downloadUrl\`/\`readyAt\`/\`expiresAt\` are populated). The lookup is constrained to \`(id, userId = session.user.id)\`, so a caller can only ever read their own export; an id that doesn't exist or isn't theirs returns **404 Not Found** (existence-hiding).

Read-only; session-only, no capability. **401** when unauthenticated. The JSON returned here describes the job; the actual archive bytes are streamed by the separate binary sub-resource \`GET /me/account/exports/:exportId/file\`.`,
    }),
    async (c) => {
      const { user } = requireSession(c);
      const row = await getExportRow(user.id, c.req.param('exportId'));
      if (!row) throw new NotFoundError('Export not found.');
      return ok(c, AccountExportOut, toExportOut(row));
    },
  );

export default meAccount;

/** Why a non-`ready` export can't be downloaded (409 messages, keyed by status). */
const NOT_READY_MESSAGE: Partial<Record<AccountExportStatus, string>> = {
  pending: 'Your export is still being prepared. Try again in a moment.',
  failed: "Your export didn't finish generating. Please request a new one.",
  expired: 'This export has expired. Please request a new one.',
};

/**
 * The export file download — the binary sub-resource of an export.
 *
 * @remarks
 * Mounted at `/v1/me/account/exports` in `server.ts`, **outside** the typed RPC `AppType`: it
 * streams a ZIP (not a JSON envelope) and is fetched via a plain `<a href>` link, not the RPC
 * client — so it stays out of the contract `hc<AppType>` consumes (same convention as
 * cron/webhooks/stream). Authorization is implicit: only the caller's own `ready` export, keyed
 * by their session, is served — the `:exportId` is verified to belong to them. The bytes come
 * through the `BlobStore.get` port, so it works against local disk and prod Vercel Blob alike.
 */
export const meAccountExportDownload: Hono<AppEnv> = new Hono<AppEnv>().get(
  '/:exportId/file',
  describeRoute({
    tags: ['Me'],
    summary: 'Download an account export file',
    description: `Stream the generated ZIP archive for a \`ready\` export — the **binary sub-resource** of an export job. Unlike the rest of the account surface this returns raw bytes (\`Content-Type: application/zip\`, \`Content-Disposition: attachment\`), not a JSON envelope, and is fetched via a plain \`<a href>\` link rather than the typed RPC client; it is therefore mounted **outside** the typed RPC \`AppType\` contract (same convention as cron/webhooks/stream). The bytes flow through the \`BlobStore.get\` port, so it works identically against local disk in dev and Vercel Blob in production.

**Authorization is implicit and per-user:** only the caller's own export is served — \`:exportId\` is verified to belong to the session user. Errors: **404** when the export doesn't exist / isn't theirs, or when the underlying blob has already been swept; **409** when the export exists but isn't downloadable yet (\`pending\`), didn't finish (\`failed\`), or has \`expired\` (each with a status-specific message). Session-only, no capability; **401** when unauthenticated.`,
  }),
  async (c) => {
    const { user } = requireSession(c);
    const row = await getExportRow(user.id, c.req.param('exportId'));
    // 404 when the export doesn't exist / isn't theirs; 409 when it exists but isn't downloadable.
    if (!row) throw new NotFoundError('Export not found.');
    if (row.status !== 'ready' || !row.blobKey) {
      throw new ConflictError(NOT_READY_MESSAGE[row.status] ?? 'This export is not available.');
    }
    const bytes = await getContainer().blob.get(row.blobKey);
    if (!bytes) throw new NotFoundError('Export file is no longer available.');
    const filename = exportFilename(user.name, row.readyAt ?? row.requestedAt);
    // Copy into a fresh `ArrayBuffer`-backed Uint8Array so the body is a valid `BodyInit`: the
    // blob port returns `Uint8Array<ArrayBufferLike>`, which the DOM `Response` typings (used
    // when the admin app compiles this source) reject in favour of the concrete `ArrayBuffer`.
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  },
);
