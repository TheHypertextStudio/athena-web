/**
 * `@docket/api` — automation runtime: the Observer that runs the engine when an observation
 * fires.
 *
 * @remarks
 * `runAutomationsForObservation` loads the org's enabled rules, builds the action-handler
 * registry, and runs the engine against the event — all best-effort (a handler failure never
 * rolls back the domain mutation that produced the observation). The default mail applier
 * resolves the integration's connector and dispatches through its {@link MailActions}
 * capability; in `local`/`test` mode that resolves to the record-only mock connector, so the
 * archive-on-complete loop is exercisable with zero external accounts. See the spec §7.
 */
import { db, integration } from '@docket/db';
import type { ConnectorProvider } from '@docket/boundaries';
import { eq } from 'drizzle-orm';

import { connectorFor, resolveConnectorToken } from '../../routes/integration-provider';
import { runAutomations } from './engine';
import { type AutomationEvent, type MailApplier, buildAutomationRegistry } from './handlers';
import type { Registry } from './registry';
import { loadEnabledRules } from './rules-store';

/** Project an emitted observation into the engine's {@link AutomationEvent} shape. */
export function projectObservation(input: {
  organizationId: string;
  kind: string;
  subject: { type: string; id: string };
  payload?: Record<string, unknown>;
  occurredAt: Date;
}): AutomationEvent {
  return {
    organizationId: input.organizationId,
    kind: input.kind,
    subjectType: input.subject.type,
    subjectId: input.subject.id,
    payload: input.payload ?? {},
    occurredAt: input.occurredAt,
  };
}

/**
 * The default mail applier: resolve the integration's connector and apply the action through
 * its mailbox capability.
 *
 * @remarks
 * Resolves the OAuth token via {@link resolveConnectorToken} (the `'mock'` sentinel in
 * local/test → the record-only mock connector). A non-mail connector or missing capability is
 * a silent no-op — the action simply doesn't happen.
 */
export const defaultMailApplier: MailApplier = async ({ integrationId, threadId, action }) => {
  const rows = await db
    .select({
      provider: integration.provider,
      createdBy: integration.createdBy,
      account: integration.externalAccountId,
    })
    .from(integration)
    .where(eq(integration.id, integrationId))
    .limit(1);
  const row = rows[0];
  if (!row?.createdBy) return;
  const provider = row.provider as ConnectorProvider;
  const token = await resolveConnectorToken(row.createdBy, provider, row.account);
  if (!token.ok) return;
  const mail = connectorFor(provider, token.token).asMailActor?.();
  if (!mail) return;
  await mail.applyMailAction({ connectionId: integrationId, provider, threadId, action });
};

/**
 * Run all matching automation rules for one observation. Best-effort: never throws.
 *
 * @param event - The projected observation event.
 * @param registry - Optional registry override (tests inject a recording one); defaults to the
 *   real registry built with {@link defaultMailApplier}.
 */
export async function runAutomationsForObservation(
  event: AutomationEvent,
  registry?: Registry,
): Promise<void> {
  try {
    const rules = await loadEnabledRules(event.organizationId);
    if (rules.length === 0) return;
    const reg = registry ?? buildAutomationRegistry({ mailApplier: defaultMailApplier });
    await runAutomations(event, rules, reg);
  } catch {
    // Automations are best-effort awareness side-effects; a failure must never roll back or
    // 500 the domain mutation that produced the observation.
  }
}
