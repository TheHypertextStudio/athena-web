/**
 * `@docket/api` — the email-to-task ingest sweep (scheduled Gmail pull → suggestions).
 *
 * @remarks
 * For each Gmail integration that has **opted in** via its config
 * (`config.emailToTask = { enabled, threshold }`), pull recent threads through the connector,
 * run them through the funnel + synthesis ({@link persistSuggestions}), and write one-per-
 * thread suggestions. Strictly opt-in and threshold-explicit — an integration with no
 * `emailToTask` config is skipped (no hidden default). Idempotent: the unique thread index
 * means a re-sweep creates nothing new. In `local`/`test` the connector resolves to the mock,
 * so the sweep runs with zero external accounts. See `docs/engineering/specs/email-to-task.md` §6.
 */
import { db, integration } from '@docket/db';
import { and, eq, isNull } from 'drizzle-orm';

import { getContainer } from '../../container';
import { seedDefaultAutomationRules } from '../automation/rules-store';
import { connectorFor, resolveConnectorToken } from '../../routes/integration-provider';
import { type CandidateThread, persistSuggestions } from './synthesize';

/** Per-integration email-to-task config (lives on `integration.config.emailToTask`). */
interface EmailToTaskConfig {
  readonly enabled?: boolean;
  readonly threshold?: number;
}

/** The outcome of one ingest sweep. */
export interface EmailSweepResult {
  /** How many integrations were opted-in and processed. */
  readonly integrations: number;
  /** How many new suggestions were created across them. */
  readonly created: number;
}

/**
 * Sweep every opted-in Gmail integration: pull threads, funnel, synthesize, persist.
 *
 * @param _now - The sweep instant (accepted for parity with the other cron sweeps).
 */
export async function sweepEmailSuggestions(_now: Date): Promise<EmailSweepResult> {
  const rows = await db
    .select({
      id: integration.id,
      organizationId: integration.organizationId,
      createdBy: integration.createdBy,
      account: integration.externalAccountId,
      config: integration.config,
    })
    .from(integration)
    .where(and(eq(integration.provider, 'gmail'), isNull(integration.archivedAt)));

  // Athena drafts the action-oriented task; the env-resolved synthesizer is the real model
  // when ANTHROPIC_API_KEY is set, else the deterministic mock (so the sweep runs offline).
  const synthesizer = getContainer().taskSynthesizer;

  let processed = 0;
  let created = 0;

  for (const row of rows) {
    const cfg = (row.config as { emailToTask?: EmailToTaskConfig } | null)?.emailToTask;
    // Opt-in + explicit threshold required — no hidden default, no scanning of un-enabled mailboxes.
    if (!cfg?.enabled || typeof cfg.threshold !== 'number') continue;
    if (!row.createdBy) continue;

    const token = await resolveConnectorToken(row.createdBy, 'gmail', row.account);
    if (!token.ok) continue;
    processed += 1;

    // Opt-in moment: ensure the org has the shipped default automation rules (idempotent), so
    // a newly-enabled org gets the dismiss-promotions / archive-on-complete defaults to edit.
    await seedDefaultAutomationRules(row.organizationId, row.createdBy);

    const items = await connectorFor('gmail', token.token).importWork({
      connectionId: row.id,
      provider: 'gmail',
    });
    const threads: CandidateThread[] = items.map((i) => ({
      threadId: i.id,
      subject: i.title,
      snippet: i.body ?? i.title,
      sender: '',
    }));

    const result = await persistSuggestions({
      organizationId: row.organizationId,
      integrationId: row.id,
      threads,
      threshold: cfg.threshold,
      actorId: row.createdBy,
      synthesizer,
    });
    created += result.created;
  }

  return { integrations: processed, created };
}
