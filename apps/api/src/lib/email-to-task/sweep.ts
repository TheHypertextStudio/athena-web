/**
 * `@docket/api` — the email-to-task ingest sweep (scheduled mailbox pull → suggestions).
 *
 * @remarks
 * For each mail-capable integration that has **opted in** via its config
 * (`config.emailToTask = { enabled, threshold }`), list threads through the connector's
 * mail capability, run them through the funnel + synthesis ({@link persistSuggestions}),
 * and write one-per-thread suggestions. Strictly opt-in and threshold-explicit — an
 * integration with no `emailToTask` config is skipped (no hidden default).
 *
 * Runs on the shared leased sync spine ({@link runLeasedSync}, purpose `email_ingest`):
 * every pull is a persisted, purposed `sync_run`; a token failure flips the integration to
 * `error` and notifies the owner (needs-reauth); the per-integration lease serializes
 * concurrent sweeps. Listing is **incremental**: the integration's `sync_state.mail` cursor
 * (Gmail `historyId`; Graph `deltaLink`) resumes from the last sweep, so an unchanged
 * mailbox costs one provider request; an expired cursor triggers exactly one full re-pull
 * (idempotent — the unique thread + Message-ID checks make re-seen threads no-ops). In
 * `local`/`test` the connector resolves to the mock, so the sweep runs with zero external
 * accounts. See `docs/engineering/specs/{email-to-task,integration-sync,mail-providers}.md`.
 */
import { db, integration } from '@docket/db';
import { ConnectorConfig, IntegrationSyncState } from '@docket/types';
import { MAIL_CAPABLE_PROVIDERS, type MailActions, type MailListPage } from '@docket/boundaries';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import { getContainer } from '../../container';
import { seedDefaultAutomationRules } from '../automation/rules-store';
import { connectorFor } from '../../routes/integration-provider';
import { type LeasedSyncContext, runLeasedSync } from '../../routes/integration-sync';
import { type CandidateThread, persistSuggestions } from './synthesize';

/** The most threads one integration ingests per sweep (cursoring keeps warm sweeps tiny). */
const MAX_INGEST_THREADS = 100;

/** The outcome of one ingest sweep. */
export interface EmailSweepResult {
  /** How many integrations were opted-in and attempted (leased or lease-skipped). */
  readonly integrations: number;
  /** How many new suggestions were created across them. */
  readonly created: number;
}

/**
 * List the integration's mailbox threads, resuming from the stored cursor.
 *
 * @remarks
 * Implements the port's documented expiry recovery: a `cursorExpired` page triggers exactly
 * one retry without a cursor (the full re-pull). A full pull reporting an expired cursor is
 * a provider-contract violation and throws.
 */
async function listWithCursorRecovery(
  mail: MailActions,
  connectionId: string,
  cursor: string | undefined,
): Promise<Extract<MailListPage, { kind: 'page' }>> {
  const first = await mail.listThreads({
    connectionId,
    ...(cursor !== undefined ? { cursor } : {}),
    maxThreads: MAX_INGEST_THREADS,
  });
  if (first.kind === 'page') return first;
  const repull = await mail.listThreads({ connectionId, maxThreads: MAX_INGEST_THREADS });
  if (repull.kind === 'page') return repull;
  throw new Error('mail provider reported an expired cursor for a cursorless full pull');
}

/**
 * The `email_ingest` executor for one opted-in integration: list (cursored) → funnel +
 * synthesize → persist suggestions → advance the cursor (still under the lease).
 */
async function ingestOne(
  ctx: LeasedSyncContext,
  threshold: number,
  actorId: string,
): Promise<{ processed: number; total: number }> {
  const mail = connectorFor(ctx.provider, ctx.token).asMailActor?.();
  // The sweep selected by the mail manifest, so a missing capability is a wiring bug — loud.
  if (!mail) throw new Error(`${ctx.provider} connector has no mail capability`);

  const parsed = IntegrationSyncState.safeParse(ctx.row.syncState);
  if (!parsed.success) {
    // Corrupt state falls back to a full pull rather than failing the sweep forever.
    console.warn('[email-to-task] invalid sync_state; running a full pull', {
      integrationId: ctx.row.id,
    });
  }
  const cursor = parsed.success ? parsed.data.mail?.cursor : undefined;

  const page = await listWithCursorRecovery(mail, ctx.row.id, cursor);

  const threads: CandidateThread[] = page.threads.map((t) => ({
    threadId: t.threadId,
    subject: t.subject,
    snippet: t.snippet,
    sender: t.from,
    receivedAt: t.receivedAt,
    ...(t.rfc822MessageId !== undefined ? { rfc822MessageId: t.rfc822MessageId } : {}),
    externalUrl: t.externalUrl,
  }));

  const result = await persistSuggestions({
    organizationId: ctx.row.organizationId,
    integrationId: ctx.row.id,
    threads,
    threshold,
    actorId,
    synthesizer: getContainer().taskSynthesizer,
  });

  // Advance the cursor under the lease (an empty cursor means the provider had no anchor —
  // keep full-pull semantics rather than storing garbage).
  if (page.nextCursor !== '') {
    const state: IntegrationSyncState = {
      ...(parsed.success ? parsed.data : {}),
      mail: { cursor: page.nextCursor, updatedAt: ctx.now.toISOString() },
    };
    await db.update(integration).set({ syncState: state }).where(eq(integration.id, ctx.row.id));
  }

  return { processed: result.created, total: page.threads.length };
}

/**
 * Sweep every opted-in, mail-capable integration: list threads, funnel, synthesize, persist.
 *
 * @param _now - The sweep instant (accepted for parity with the other cron sweeps).
 */
export async function sweepEmailSuggestions(_now: Date): Promise<EmailSweepResult> {
  const rows = await db
    .select()
    .from(integration)
    .where(
      and(
        inArray(integration.provider, [...MAIL_CAPABLE_PROVIDERS]),
        inArray(integration.status, ['connected', 'error']),
        isNull(integration.archivedAt),
      ),
    );

  let attempted = 0;
  let created = 0;

  for (const row of rows) {
    // Shared typed config (the same schema the settings PATCH validates against). Opt-in +
    // explicit threshold required — no hidden default, no scanning of un-enabled mailboxes.
    const parsed = ConnectorConfig.safeParse(row.config);
    if (!parsed.success) {
      console.warn('[email-to-task] invalid integration config; skipping', {
        integrationId: row.id,
      });
      continue;
    }
    const cfg = parsed.data.emailToTask;
    if (!cfg?.enabled) continue;
    const threshold = cfg.threshold;
    const actorId = row.createdBy;
    if (!actorId) continue;
    attempted += 1;

    // Opt-in moment: ensure the org has the shipped default automation rules (idempotent), so
    // a newly-enabled org gets the dismiss-promotions / archive-on-complete defaults to edit.
    await seedDefaultAutomationRules(row.organizationId, actorId);

    const run = await runLeasedSync(
      row,
      { actorId, trigger: 'scheduled', purpose: 'email_ingest' },
      (ctx) => ingestOne(ctx, threshold, actorId),
    );
    if (run?.status === 'succeeded') created += run.processed;
  }

  return { integrations: attempted, created };
}
