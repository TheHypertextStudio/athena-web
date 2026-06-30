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

/** Builds the concrete {@link MailAction} for a handler from the rule's `then` params. */
type MailActionBuilder = (params: Record<string, unknown>) => MailAction | null;

/**
 * Build a mail handler: find the firing task's email attachment(s), derive the concrete
 * {@link MailAction} from the rule params, apply it, and record it on the attachment.
 *
 * @remarks
 * No email attachment → no-op; a label action with no `params.label` → no-op. The
 * `lastEmailStateAction` record is last-action-wins, not a full applied-set: it suppresses
 * the *same* action firing twice in a row on a thread (the archive-on-complete case), which is
 * all the shipped rules need.
 */
function mailHandler(type: string, build: MailActionBuilder, deps: HandlerDeps) {
  return {
    type,
    run: async (ctx: ActionContext, params: Record<string, unknown>): Promise<void> => {
      const event = eventOf(ctx);
      if (!event.subjectId) return;
      const action = build(params);
      if (!action) return;
      const rows = await db
        .select({
          id: attachment.id,
          sourceIntegrationId: attachment.sourceIntegrationId,
          externalId: attachment.externalId,
          lastEmailStateAction: attachment.lastEmailStateAction,
        })
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
        if (att.lastEmailStateAction === type) continue; // same action already applied last
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

/** A label action reads `params.label`, no-op'ing (`null`) when the rule omits it. */
const labelBuilder =
  (kind: 'applyLabel' | 'removeLabel'): MailActionBuilder =>
  (params) =>
    typeof params['label'] === 'string' ? { kind, label: params['label'] } : null;

/** The `mail.*` action types and how each derives its {@link MailAction} from rule params. */
const MAIL_ACTIONS: { readonly type: string; readonly build: MailActionBuilder }[] = [
  { type: 'mail.archive', build: () => ({ kind: 'archive' }) },
  { type: 'mail.markRead', build: () => ({ kind: 'markRead' }) },
  { type: 'mail.markUnread', build: () => ({ kind: 'markUnread' }) },
  { type: 'mail.trash', build: () => ({ kind: 'trash' }) },
  { type: 'mail.applyLabel', build: labelBuilder('applyLabel') },
  { type: 'mail.removeLabel', build: labelBuilder('removeLabel') },
];

/**
 * Build the action-handler registry.
 *
 * @param deps - Injected services (the mail applier).
 * @returns a registry with the `mail.*` and `suggestion.*` strategies registered.
 */
export function buildAutomationRegistry(deps: HandlerDeps): Registry {
  const registry = createRegistry();

  for (const m of MAIL_ACTIONS) registry.register(mailHandler(m.type, m.build, deps));

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
