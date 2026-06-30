/**
 * `@docket/api` — the asynchronous personal-data export.
 *
 * @remarks
 * `collectAccountExport` snapshots everything tied to a user — their identity + linked
 * accounts + consents, every org they belong to (each org's work layer), and their cross-org
 * personal rows (hub, daily plan, notifications, observations, digests, stream follows) — into
 * one JSON document. `sweepAccountExports` is the idempotent cron drain: it generates a
 * `pending` job's archive to blob storage, advances it to `ready`, emails the download link,
 * and expires `ready` artifacts past their TTL. Mirrors the daily-digest sweep (uses the
 * shared {@link getContainer} blob + mailer ports; safe to retry).
 */
import type { Database } from '@docket/db';
import {
  accountExport,
  actor,
  dailyDigest,
  dailyPlanItem,
  hub,
  notification,
  oauthConsent,
  observation,
  observationRecipient,
  organization,
  streamSubscription,
  user,
} from '@docket/db';
import { and, eq, inArray, lte } from 'drizzle-orm';

import { getContainer } from '../container';
import { env } from '../env';
import { collectWorkLayer } from '../lib/export-collect';
import { one } from '../lib/one';
import { linkedIdentities } from '../routes/integration-provider';

import { type ExportDocument, buildExportArchive } from './archive';
import { exportReadyEmail } from './emails';

/** Days a generated export download URL is advertised as valid for. */
export const ACCOUNT_EXPORT_TTL_DAYS = 14;

/** Milliseconds in {@link ACCOUNT_EXPORT_TTL_DAYS}. */
const ACCOUNT_EXPORT_TTL_MS = ACCOUNT_EXPORT_TTL_DAYS * 24 * 60 * 60 * 1000;

/** The outcome of a {@link sweepAccountExports} run. */
export interface AccountExportSweepResult {
  /** Pending exports successfully generated to blob storage this run. */
  readonly generated: number;
  /** Pending exports that errored this run (left as `failed`). */
  readonly failed: number;
  /** Ready exports moved to `expired` because their link TTL elapsed. */
  readonly expired: number;
}

/** A collected account export plus the user row it was built from (reused for the email). */
export interface AccountExportDocument {
  /** The structured export payload (zipped into the downloadable archive). */
  readonly document: ExportDocument;
  /** The user row, or null if the account no longer exists. */
  readonly user: typeof user.$inferSelect | null;
}

/**
 * Snapshot every record tied to a user into one structured export document.
 *
 * @param db - The database client.
 * @param userId - The user whose account to export.
 * @returns the export document and the user row it was built from.
 */
export async function collectAccountExport(
  db: Database,
  userId: string,
): Promise<AccountExportDocument> {
  // First wave: every read that doesn't depend on the hub id, in parallel. The org list is a
  // single query (subquery over the user's human memberships) rather than ids-then-fetch.
  const [userRow, hubRow, identities, consents, orgs] = await Promise.all([
    one(db.select().from(user).where(eq(user.id, userId))),
    one(db.select().from(hub).where(eq(hub.userId, userId))),
    linkedIdentities(userId),
    db.select().from(oauthConsent).where(eq(oauthConsent.userId, userId)),
    db
      .select()
      .from(organization)
      .where(
        inArray(
          organization.id,
          db
            .select({ id: actor.organizationId })
            .from(actor)
            .where(and(eq(actor.userId, userId), eq(actor.kind, 'human'))),
        ),
      ),
  ]);
  const hubId = hubRow?.id;

  // Second wave: each org's work layer, and the cross-org personal rows, in parallel.
  const [memberships, personal] = await Promise.all([
    Promise.all(
      orgs.map(async (org) => ({ organization: org, work: await collectWorkLayer(org.id, db) })),
    ),
    (async () => {
      const [planItems, notifications, observations, recipients, digests, follows] =
        await Promise.all([
          hubId
            ? db.select().from(dailyPlanItem).where(eq(dailyPlanItem.hubId, hubId))
            : Promise.resolve([]),
          db.select().from(notification).where(eq(notification.userId, userId)),
          db.select().from(observation).where(eq(observation.userId, userId)),
          db.select().from(observationRecipient).where(eq(observationRecipient.userId, userId)),
          db.select().from(dailyDigest).where(eq(dailyDigest.userId, userId)),
          db.select().from(streamSubscription).where(eq(streamSubscription.userId, userId)),
        ]);
      return {
        hub: hubRow ?? null,
        dailyPlan: planItems,
        notifications,
        observations,
        observationRecipients: recipients,
        dailyDigests: digests,
        streamSubscriptions: follows,
      };
    })(),
  ]);

  const document = {
    schemaVersion: 1,
    identity: { user: userRow ?? null, linkedAccounts: identities, connectedApps: consents },
    memberships,
    personal,
  };
  return { document, user: userRow ?? null };
}

/**
 * Idempotently drain the export queue: generate pending archives, expire stale links.
 *
 * @remarks
 * For each `pending` job: collect the account export, write it to blob storage, stamp
 * `blob_key`/`ready_at`/`expires_at`, advance to `ready`, and email the download link. A
 * generation error leaves the job `failed` with the message (it is not retried). Separately,
 * `ready` jobs past `expires_at` advance to `expired`. Re-running is safe — only `pending`
 * jobs are generated and only un-expired `ready` jobs are expired.
 *
 * @param db - The database client.
 * @param now - The sweep's reference instant (ISO-8601).
 * @returns the per-outcome counts.
 */
export async function sweepAccountExports(
  db: Database,
  now: string,
): Promise<AccountExportSweepResult> {
  const nowDate = new Date(now);
  const { blob, mailer } = getContainer();

  // Expire ready artifacts whose link TTL has elapsed.
  const expiredRows = await db
    .update(accountExport)
    .set({ status: 'expired' })
    .where(and(eq(accountExport.status, 'ready'), lte(accountExport.expiresAt, nowDate)))
    .returning({ id: accountExport.id });

  const pending = await db.select().from(accountExport).where(eq(accountExport.status, 'pending'));

  let generated = 0;
  let failed = 0;
  for (const job of pending) {
    try {
      const { document, user: userRow } = await collectAccountExport(db, job.userId);
      const expiresAt = new Date(nowDate.getTime() + ACCOUNT_EXPORT_TTL_MS);
      // A self-describing ZIP (README + split JSON), not a bare blob of JSON.
      const archive = buildExportArchive(document, {
        generatedAt: now,
        expiresAt: expiresAt.toISOString(),
        name: userRow?.name ?? null,
        email: userRow?.email ?? null,
      });
      const key = `exports/account/${job.userId}/${nowDate.getTime()}.zip`;
      await blob.put(key, archive, 'application/zip');

      await db
        .update(accountExport)
        .set({ status: 'ready', blobKey: key, readyAt: nowDate, expiresAt, error: null })
        .where(eq(accountExport.id, job.id));

      // Reuse the user row already loaded by collectAccountExport (no second query). The link
      // points at the RESTful download sub-resource (works in local dev + prod via blob.get).
      if (userRow) {
        const email = exportReadyEmail({
          name: userRow.name,
          downloadUrl: `${env.API_URL}/v1/me/account/exports/${job.id}/file`,
          expiresAt: expiresAt.toISOString(),
        });
        await mailer.send({ to: userRow.email, ...email });
      }
      generated += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'export generation error';
      await db
        .update(accountExport)
        .set({ status: 'failed', error: message })
        .where(eq(accountExport.id, job.id));
      failed += 1;
    }
  }

  return { generated, failed, expired: expiredRows.length };
}
