/**
 * `@docket/api` — automation runtime: the Observer that runs the engine when an event fires.
 *
 * @remarks
 * Both event write paths — the internal emit Facade (`event-emit.ts`) and the external
 * webhook drain (`event-sync.ts`) — project their just-committed event into the engine's
 * {@link AutomationEvent} shape and call {@link runAutomationsForEvent}. Everything is
 * best-effort: a handler failure never rolls back or 500s the domain mutation that produced
 * the event. Delivery is inline today; because both call sites go through the pure projection
 * functions (`./event.ts`) and this one entry point, a durable async drain can replace them
 * later without touching the engine.
 *
 * Re-entrancy: action handlers may themselves emit events (`task.setStatus` emits
 * `completed`). Those events are still recorded and fanned out normally, but they do NOT
 * trigger another rule pass — an {@link AsyncLocalStorage} marker caps rule cascading at
 * depth 1, so a rule can never recursively re-fire itself or others.
 *
 * The default mail applier resolves the integration's connector and dispatches through its
 * {@link MailActions} capability; in `local`/`test` mode that resolves to the record-only
 * mock connector, so the archive-on-complete loop is exercisable with zero external accounts.
 * See `docs/engineering/specs/automations.md`.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

import { db, integration } from '@docket/db';
import type { ConnectorProvider } from '@docket/boundaries';
import { eq } from 'drizzle-orm';

import { connectorFor, resolveConnectorToken } from '../../routes/integration-provider';
import { runAutomations } from './engine';
import type { AutomationEvent } from './event';
import { buildAutomationRegistry, type MailApplier } from './handlers';
import type { Registry } from './registry';
import { loadEnabledRules } from './rules-store';

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
 * The default action-handler registry, built once. Its only dependency is the module-constant
 * {@link defaultMailApplier}, so it's immutable for the process lifetime — no need to rebuild it
 * (a fresh Map + handler closures) on every event.
 */
const defaultRegistry = buildAutomationRegistry({ mailApplier: defaultMailApplier });

/**
 * Marks execution that is already inside a rule's action dispatch. Events emitted from inside
 * (handlers calling `emitEvent`) are recorded normally but skip the rule pass — the depth-1
 * cascade cap.
 */
const automationDispatch = new AsyncLocalStorage<true>();

/**
 * Run all matching automation rules for one committed event. Best-effort: never throws.
 *
 * @remarks
 * A no-op when called from inside another rule's action dispatch (see the module remarks on
 * re-entrancy) and when the org has no enabled rules.
 *
 * @param event - The projected event (see {@link projectEmitInput} / {@link projectInboundDraft}).
 * @param registry - Optional registry override (tests inject a recording one); defaults to the
 *   shared {@link defaultRegistry}.
 */
export async function runAutomationsForEvent(
  event: AutomationEvent,
  registry?: Registry,
): Promise<void> {
  if (automationDispatch.getStore() !== undefined) return; // depth-1 cascade cap
  try {
    const rules = await loadEnabledRules(event.organizationId);
    if (rules.length === 0) return;
    await automationDispatch.run(true, () =>
      runAutomations(event, rules, registry ?? defaultRegistry),
    );
  } catch (error) {
    // Automations are best-effort awareness side-effects; a failure must never roll back or
    // 500 the domain mutation that produced the event — but it shouldn't vanish silently.
    console.warn('[automation] rule run failed', { kind: event.kind, error });
  }
}
