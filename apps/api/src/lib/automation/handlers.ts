/**
 * `@docket/api` — automation action handlers (the Strategy registry's strategies).
 *
 * @remarks
 * Each handler reacts to the firing observation ({@link AutomationEvent}, carried on
 * `ctx.event`) using injected services. `mail.*` mutate the source email of a task's email
 * attachment via the injected {@link MailApplier} and stamp the attachment's action ledger
 * (idempotency Decorator — a thread is not re-acted on for the same action). `suggestion.*`
 * act on the `email_suggestion` row named in the event payload. See the email-to-task spec §7.
 */
import { attachment, db, emailSuggestion } from '@docket/db';
import type { MailAction } from '@docket/boundaries';
import { and, eq } from 'drizzle-orm';

import type { ActionContext } from './engine';
import { createRegistry, type Registry } from './registry';

/** The structured observation an automation reacts to (an observation projected to a record). */
export interface AutomationEvent {
  readonly organizationId: string;
  readonly kind: string;
  readonly subjectType?: string;
  readonly subjectId?: string;
  readonly payload: Record<string, unknown>;
  /** Marker so the firing time is stable/injectable (never `Date.now()` inside handlers). */
  readonly occurredAt: Date;
}

/** Applies one mailbox action to a thread of a given integration (wraps the connector). */
export type MailApplier = (input: {
  organizationId: string;
  integrationId: string;
  threadId: string;
  action: MailAction;
}) => Promise<void>;

/** Services the handlers close over (injected so the registry is testable offline). */
export interface HandlerDeps {
  readonly mailApplier: MailApplier;
}

/** Read the structured event off the action context. */
function eventOf(ctx: ActionContext): AutomationEvent {
  return ctx.event as AutomationEvent;
}

/**
 * Build a mail handler for one {@link MailAction}: find the firing task's email attachment,
 * apply the action to its thread (skipping if the same action was already applied — the
 * idempotency ledger), and stamp the ledger. No email attachment → no-op.
 */
function mailHandler(type: string, action: MailAction, deps: HandlerDeps) {
  return {
    type,
    run: async (ctx: ActionContext): Promise<void> => {
      const event = eventOf(ctx);
      if (!event.subjectId) return;
      const rows = await db
        .select()
        .from(attachment)
        .where(
          and(
            eq(attachment.organizationId, event.organizationId),
            eq(attachment.subjectType, 'task'),
            eq(attachment.subjectId, event.subjectId),
            eq(attachment.kind, 'email'),
          ),
        );
      for (const att of rows) {
        if (!att.sourceIntegrationId || !att.externalId) continue;
        if (att.lastEmailStateAction === type) continue; // idempotency: already applied
        await deps.mailApplier({
          organizationId: event.organizationId,
          integrationId: att.sourceIntegrationId,
          threadId: att.externalId,
          action,
        });
        await db
          .update(attachment)
          .set({ lastEmailStateAction: type, lastEmailStateActionAt: event.occurredAt })
          .where(eq(attachment.id, att.id));
      }
    },
  };
}

/**
 * Build the action-handler registry.
 *
 * @param deps - Injected services (the mail applier).
 * @returns a registry with the `mail.*` and `suggestion.*` strategies registered.
 */
export function buildAutomationRegistry(deps: HandlerDeps): Registry {
  const registry = createRegistry();

  const mailActions: { readonly type: string; readonly action: MailAction }[] = [
    { type: 'mail.archive', action: { kind: 'archive' } },
    { type: 'mail.markRead', action: { kind: 'markRead' } },
    { type: 'mail.markUnread', action: { kind: 'markUnread' } },
    { type: 'mail.trash', action: { kind: 'trash' } },
  ];
  for (const m of mailActions) registry.register(mailHandler(m.type, m.action, deps));

  // suggestion.dismiss — discard the suggestion named in the event payload.
  registry.register({
    type: 'suggestion.dismiss',
    run: async (ctx: ActionContext): Promise<void> => {
      const event = eventOf(ctx);
      const suggestionId = event.payload['suggestionId'];
      if (typeof suggestionId !== 'string') return;
      await db
        .update(emailSuggestion)
        .set({ status: 'dismissed' })
        .where(
          and(
            eq(emailSuggestion.id, suggestionId),
            eq(emailSuggestion.organizationId, event.organizationId),
            eq(emailSuggestion.status, 'pending'),
          ),
        );
    },
  });

  return registry;
}
