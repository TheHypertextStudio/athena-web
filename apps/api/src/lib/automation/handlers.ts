/**
 * `@docket/api` — automation action handlers (the Strategy registry's strategies).
 *
 * @remarks
 * Each handler reacts to the firing event ({@link AutomationEvent}, carried on
 * `ctx.event`) using injected services. `mail.*` mutate the source email of a task's email
 * attachment via the injected {@link MailApplier} and stamp the attachment's action ledger
 * (idempotency Decorator — a thread is not re-acted on for the same action). `suggestion.*`
 * act on the `email_suggestion` subject the event fired on. See
 * `docs/engineering/specs/automations.md`.
 */
import {
  actor,
  attachment,
  db,
  emailSuggestion,
  label,
  notification,
  task,
  taskLabel,
} from '@docket/db';
import { Priority } from '@docket/types';
import type { MailAction } from '@docket/integrations';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { setTaskState } from '../task-state';
import { acceptSuggestion } from '../email-to-task/accept';
import { emitEvent } from '../../routes/event-emit';
import { enqueueSearchUpsert } from '../../search/write-through';
import type { ActionContext } from './engine';
import type { AutomationEvent } from './event';
import { createRegistry, type Registry } from './registry';

export type { AutomationEvent } from './event';

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
        await enqueueSearchUpsert(event.organizationId, 'attachment', att.id);
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

/** `task.setStatus` params. */
const SetStatusParams = z.object({ state: z.string().min(1) });
/** `task.assign` params. */
const AssignParams = z.object({ assigneeId: z.string().min(1) });
/** `task.setPriority` params. */
const SetPriorityParams = z.object({ priority: Priority });
/** `task.applyLabel` params. */
const ApplyLabelParams = z.object({ labelId: z.string().min(1) });
/** `notification.send` params. */
const NotificationSendParams = z.object({
  to: z.enum(['actor', 'taskAssignee']),
  title: z.string().min(1),
  summary: z.string().optional(),
});

/** Load the firing task subject (org-scoped, active), or `undefined` for a no-op. */
async function taskOf(event: AutomationEvent): Promise<typeof task.$inferSelect | undefined> {
  if (event.subjectType !== 'task' || !event.subjectId) return undefined;
  const rows = await db
    .select()
    .from(task)
    .where(
      and(
        eq(task.id, event.subjectId),
        eq(task.organizationId, event.organizationId),
        isNull(task.archivedAt),
      ),
    )
    .limit(1);
  return rows[0];
}

/** Resolve a Docket actor id to its Better Auth user id (notification target), org-scoped. */
async function userIdOfActor(orgId: string, actorId: string): Promise<string | undefined> {
  const rows = await db
    .select({ userId: actor.userId })
    .from(actor)
    .where(and(eq(actor.id, actorId), eq(actor.organizationId, orgId)))
    .limit(1);
  return rows[0]?.userId ?? undefined;
}

/**
 * Build the action-handler registry.
 *
 * @remarks
 * Every handler validates its params with a colocated Zod schema and no-ops (returns
 * without effect) on a wrong subject type or invalid params — a rule can misfire, never
 * throw domain errors. Mutating handlers reuse the shared lib mutations (`setTaskState`,
 * `acceptSuggestion`) so route and automation behavior can't diverge; events they emit are
 * recorded but don't cascade (the runtime's depth-1 cap). See
 * `docs/engineering/specs/automations.md` §4 for the catalog.
 *
 * @param deps - Injected services (the mail applier).
 * @returns a registry with the `mail.*`, `suggestion.*`, `task.*`, and `notification.*`
 *   strategies registered.
 */
export function buildAutomationRegistry(deps: HandlerDeps): Registry {
  const registry = createRegistry();

  for (const m of MAIL_ACTIONS) registry.register(mailHandler(m.type, m.build, deps));

  // task.setStatus — move the firing task to a workflow state (shared transition lib).
  registry.register({
    type: 'task.setStatus',
    run: async (ctx, params): Promise<void> => {
      const event = eventOf(ctx);
      const parsed = SetStatusParams.safeParse(params);
      if (!parsed.success || event.subjectType !== 'task' || !event.subjectId) return;
      try {
        await setTaskState({
          organizationId: event.organizationId,
          taskId: event.subjectId,
          state: parsed.data.state,
          actorId: event.actorId ?? null,
        });
      } catch (error) {
        // Unknown state key for the task's team — a rule-config problem, not a throw.
        console.warn('[automation] task.setStatus skipped', {
          taskId: event.subjectId,
          state: parsed.data.state,
          error,
        });
      }
    },
  });

  // task.assign — assign the firing task to an org actor.
  registry.register({
    type: 'task.assign',
    run: async (ctx, params): Promise<void> => {
      const event = eventOf(ctx);
      const parsed = AssignParams.safeParse(params);
      if (!parsed.success) return;
      const row = await taskOf(event);
      if (!row) return;
      const assignee = await db
        .select({ id: actor.id })
        .from(actor)
        .where(
          and(eq(actor.id, parsed.data.assigneeId), eq(actor.organizationId, event.organizationId)),
        )
        .limit(1);
      if (!assignee[0]) return; // not an org actor — no-op, never cross-tenant
      await db.update(task).set({ assigneeId: parsed.data.assigneeId }).where(eq(task.id, row.id));
      await emitEvent({
        organizationId: event.organizationId,
        kind: 'assignment',
        actorId: event.actorId ?? null,
        title: row.title,
        subject: { type: 'task', id: row.id, title: row.title },
      });
    },
  });

  // task.setPriority — set the firing task's priority.
  registry.register({
    type: 'task.setPriority',
    run: async (ctx, params): Promise<void> => {
      const event = eventOf(ctx);
      const parsed = SetPriorityParams.safeParse(params);
      if (!parsed.success) return;
      const row = await taskOf(event);
      if (!row) return;
      await db.update(task).set({ priority: parsed.data.priority }).where(eq(task.id, row.id));
    },
  });

  // task.applyLabel — attach an org label to the firing task (idempotent via the join PK).
  registry.register({
    type: 'task.applyLabel',
    run: async (ctx, params): Promise<void> => {
      const event = eventOf(ctx);
      const parsed = ApplyLabelParams.safeParse(params);
      if (!parsed.success) return;
      const row = await taskOf(event);
      if (!row) return;
      const labelRow = await db
        .select({ id: label.id })
        .from(label)
        .where(
          and(eq(label.id, parsed.data.labelId), eq(label.organizationId, event.organizationId)),
        )
        .limit(1);
      if (!labelRow[0]) return; // not an org label — no-op, never cross-tenant
      await db
        .insert(taskLabel)
        .values({
          taskId: row.id,
          labelId: parsed.data.labelId,
          organizationId: event.organizationId,
        })
        .onConflictDoNothing();
    },
  });

  // notification.send — write an inbox notification to the acting user or the task assignee.
  registry.register({
    type: 'notification.send',
    run: async (ctx, params): Promise<void> => {
      const event = eventOf(ctx);
      const parsed = NotificationSendParams.safeParse(params);
      if (!parsed.success) return;
      let targetActorId: string | undefined;
      if (parsed.data.to === 'actor') {
        targetActorId = event.actorId;
      } else {
        const row = await taskOf(event);
        targetActorId = row?.assigneeId ?? undefined;
      }
      if (targetActorId === undefined) return;
      const userId = await userIdOfActor(event.organizationId, targetActorId);
      if (userId === undefined) return; // agent actors have no inbox
      await db.insert(notification).values({
        userId,
        organizationId: event.organizationId,
        type: 'automation',
        body: {
          title: parsed.data.title,
          ...(parsed.data.summary !== undefined ? { summary: parsed.data.summary } : {}),
          ...(event.subjectType === 'task' && event.subjectId
            ? { url: `/orgs/${event.organizationId}/tasks/${event.subjectId}` }
            : {}),
        },
      });
    },
  });

  // suggestion.autoAccept — materialize the firing pending suggestion (shared accept lib).
  registry.register({
    type: 'suggestion.autoAccept',
    run: async (ctx): Promise<void> => {
      const event = eventOf(ctx);
      if (event.subjectType !== 'email_suggestion' || !event.subjectId) return;
      // The accepting actor: the event's actor, else the suggestion's creator (the
      // integration owner) — the same identity the ingest sweep runs under.
      let actorId = event.actorId;
      if (actorId === undefined) {
        const rows = await db
          .select({ createdBy: emailSuggestion.createdBy })
          .from(emailSuggestion)
          .where(
            and(
              eq(emailSuggestion.id, event.subjectId),
              eq(emailSuggestion.organizationId, event.organizationId),
            ),
          )
          .limit(1);
        actorId = rows[0]?.createdBy ?? undefined;
      }
      if (actorId === undefined) return;
      try {
        const result = await acceptSuggestion({
          organizationId: event.organizationId,
          suggestionId: event.subjectId,
          actorId,
          overrides: {},
        });
        if (result.kind !== 'accepted') {
          console.warn('[automation] suggestion.autoAccept skipped', {
            suggestionId: event.subjectId,
            outcome: result.kind,
          });
        }
      } catch (error) {
        // A malformed suggestion row (e.g. missing externalUrl) is a data problem, not a reason
        // to abort every other rule/action matching this event — mirrors task.setStatus above.
        console.warn('[automation] suggestion.autoAccept failed', {
          suggestionId: event.subjectId,
          error,
        });
      }
    },
  });

  // suggestion.dismiss — discard the email_suggestion subject the event fired on.
  registry.register({
    type: 'suggestion.dismiss',
    run: async (ctx: ActionContext): Promise<void> => {
      const event = eventOf(ctx);
      if (event.subjectType !== 'email_suggestion' || !event.subjectId) return;
      await db
        .update(emailSuggestion)
        .set({ status: 'dismissed' })
        .where(
          and(
            eq(emailSuggestion.id, event.subjectId),
            eq(emailSuggestion.organizationId, event.organizationId),
            eq(emailSuggestion.status, 'pending'),
          ),
        );
    },
  });

  return registry;
}
