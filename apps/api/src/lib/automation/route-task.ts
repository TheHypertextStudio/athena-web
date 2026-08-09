/**
 * `@docket/api` — inbound-item routing: turn a monitored stream item into a workspace task.
 *
 * @remarks
 * The last link in ambient ingestion. Gmail sweeps, GitHub webhooks and Linear webhooks all
 * already end at a committed observation that the automation engine sees; until now the only
 * thing a rule could do with one was act on a Docket entity that *already* existed. This module
 * is what a rule dispatches when the answer is "there should be a task for this, over there":
 * it resolves the observation back to the inbound item behind it, decides which task that item
 * belongs to, and creates or updates exactly one.
 *
 * Three properties matter more than the feature itself, because an automation that gets any of
 * them wrong is an automation people turn off:
 *
 * - **One item, one task.** Every route is keyed on the item's stable external identity in
 *   {@link inboundTaskRoute} — an email's RFC 5322 Message-ID, a pull request's node id — never
 *   on the delivery that carried it. A re-listed thread, a redelivered webhook, or two rules
 *   naming the same target all converge on the row that exists.
 * - **Later events find the task, not a copy of it.** A pull request opened and then closed is
 *   one identity across two deliveries, so the close updates what the open created.
 * - **Routing across workspaces is authorized, not assumed.** A rule lives in one workspace and
 *   may name another as its target; that is the whole point of "an LVBT email becomes an LVBT
 *   task" when the mailbox is connected somewhere else. It is also a cross-tenant write, so the
 *   person the routing runs as must be an active member of the target workspace, and the task is
 *   written under their actor *there*. Otherwise it is a logged no-op, exactly like the
 *   cross-tenant refusals in `task.assign` and `task.applyLabel`.
 *
 * Task creation goes through the shared landing resolver and the real event facade, so a routed
 * task is indistinguishable from a captured one: it lands on the same team, in the same first
 * workflow state, and its `created` event reaches the feed, search, and any Athena assignment
 * trigger watching that workspace's work.
 */
import {
  actor,
  attachment,
  db,
  emailSuggestion,
  inboundTaskRoute,
  integration,
  label,
  project,
  task,
  taskLabel,
} from '@docket/db';
import {
  EmailSuggestionMeta,
  Priority,
  SourceSystemKind,
  providerSourceSystem,
  type DirectoryProviderId,
} from '@docket/types';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { emitEvent } from '../../routes/event-emit';
import { enqueueSearchUpsert } from '../../search/write-through';
import { resolveLandingTarget } from '../task-landing';
import type { AutomationEvent } from './event';

/**
 * `task.route` params — the routing target, as stored on the rule.
 *
 * @remarks
 * Every field is optional and every field is data: a rule says where an item belongs, and the
 * handler applies exactly what the rule named. `organizationId` absent means "this workspace",
 * which is the common case; naming another workspace is what makes routing cross-workspace.
 * `state` and `priority` are applied on update as well as on create, because "a closed pull
 * request means the task is done" is the shape of the rules that need them.
 */
export const RouteTaskParams = z.object({
  /** The workspace the task belongs in; defaults to the firing event's workspace. */
  organizationId: z.string().min(1).optional(),
  /** The team to land on; defaults to the target workspace's landing team. */
  teamId: z.string().min(1).optional(),
  /**
   * The project to file the task under.
   *
   * @remarks
   * Also the handle that makes routed work reachable by an Athena assignment: an assignment
   * scoped to a project fires its event triggers for every task in that project, so "route LVBT
   * opportunities into the LVBT Partnerships project" is simultaneously "have Athena pick them
   * up". Ignored when the project belongs to another workspace.
   */
  projectId: z.string().min(1).optional(),
  /** The workflow-state key to set (on create and on update). */
  state: z.string().min(1).optional(),
  /** The priority to set (on create and on update). */
  priority: Priority.optional(),
  /** An org label to attach (idempotent via the join's primary key). */
  labelId: z.string().min(1).optional(),
});
/** Routing-target value. */
export type RouteTaskParams = z.infer<typeof RouteTaskParams>;

/** What one routing attempt did — returned for logging and asserted by tests. */
export type RouteTaskOutcome =
  | { readonly kind: 'created'; readonly taskId: string }
  | { readonly kind: 'updated'; readonly taskId: string }
  | { readonly kind: 'skipped'; readonly reason: RouteSkipReason };

/** Why a routing attempt did nothing. Each is a no-op, never a throw. */
export type RouteSkipReason =
  /** The firing event is not about an inbound item (an internal Docket event, say). */
  | 'not_inbound'
  /** The item carries no stable external identity, so it cannot be deduped or linked. */
  | 'no_source_key'
  /** The named suggestion row is gone, or was already resolved by someone else. */
  | 'suggestion_unavailable'
  /** The routing person is not an active member of the target workspace. */
  | 'not_a_member'
  /** The target workspace has no team for a task to land on. */
  | 'no_team';

/**
 * The inbound item behind one firing event, normalized across mail and webhook ingestion.
 *
 * @remarks
 * The two ingestion paths end in different rows — `email_suggestion` for a mailbox sweep, a
 * canonical `event` for a webhook drain — but routing needs the same six facts from either, so
 * they are resolved into this shape once and the rest of the module is source-agnostic.
 */
interface InboundItem {
  readonly sourceSystem: SourceSystemKind;
  /** The item's stable external identity — the dedupe and linkage key. */
  readonly sourceKey: string;
  readonly sourceUrl: string | null;
  readonly integrationId: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly priority: Priority | null;
  readonly dueDate: Date | null;
  /** The `email_suggestion` this item came from, when it came from the mailbox sweep. */
  readonly suggestionId: string | null;
  /** The email metadata to attach to the created task, when there is an email behind it. */
  readonly emailMeta: unknown;
  /** A Docket task the ingestion layer already resolved this item to, when it resolved one. */
  readonly linkedTaskId: string | null;
  /** The actor the routing should run as, in the event's own workspace. */
  readonly actorId: string | null;
}

/** Resolve the mailbox item behind an `email_suggestion` event, or `null` if it is unusable. */
async function mailItem(event: AutomationEvent): Promise<InboundItem | null> {
  if (!event.subjectId) return null;
  const rows = await db
    .select({ suggestion: emailSuggestion, provider: integration.provider })
    .from(emailSuggestion)
    .innerJoin(integration, eq(integration.id, emailSuggestion.integrationId))
    .where(
      and(
        eq(emailSuggestion.id, event.subjectId),
        eq(emailSuggestion.organizationId, event.organizationId),
      ),
    )
    .limit(1);
  const row = rows[0];
  // Already accepted or dismissed means this mail has been dealt with — routing it again is how
  // a second task appears for one email.
  if (row?.suggestion.status !== 'pending') return null;

  const meta = EmailSuggestionMeta.safeParse(row.suggestion.emailMeta);
  // The mail provider decides the source badge; a provider with no source system (or one that
  // has left the catalog) still routes, tagged with the mail source it plainly is.
  const source = providerSourceSystem(row.provider as DirectoryProviderId) ?? 'gmail';
  return {
    sourceSystem: source,
    // The RFC 5322 Message-ID is the cross-provider identity of the mail itself; the provider
    // thread id is the fallback for providers that omit it. Preferring the Message-ID means the
    // same mail seen through two mailboxes routes to one task.
    sourceKey: row.suggestion.rfc822MessageId ?? row.suggestion.externalThreadId,
    // `externalUrl` is optional on the meta schema even though ingest always stamps it, so a
    // legacy row without one routes anyway — it just carries no clickable provenance link and
    // gets no email attachment (which needs a URL).
    sourceUrl: (meta.success ? meta.data.externalUrl : undefined) ?? null,
    integrationId: row.suggestion.integrationId,
    title: row.suggestion.title,
    description: row.suggestion.description,
    priority: row.suggestion.priority,
    dueDate: row.suggestion.dueDate,
    suggestionId: row.suggestion.id,
    emailMeta: row.suggestion.emailMeta,
    linkedTaskId: null,
    actorId: event.actorId ?? row.suggestion.createdBy,
  };
}

/** Resolve the webhook item behind an external event, or `null` if it carries no identity. */
function externalItem(event: AutomationEvent): InboundItem | null {
  const source = SourceSystemKind.safeParse(event.source);
  if (!source.success || source.data === 'docket') return null;
  if (event.externalId === undefined) return null;
  return {
    sourceSystem: source.data,
    sourceKey: event.externalId,
    sourceUrl: event.externalUrl ?? null,
    integrationId: null,
    title: event.subjectTitle ?? `${source.data} item ${event.externalId}`,
    description: null,
    priority: null,
    dueDate: null,
    suggestionId: null,
    emailMeta: null,
    // Ingestion may have already matched this external entity to a Docket task (a mirrored
    // Linear issue, a task linked to a PR). That task IS the linked task — routing must update
    // it rather than open a second one alongside the mirror.
    linkedTaskId: event.subjectType === 'task' ? (event.subjectId ?? null) : null,
    actorId: event.actorId ?? null,
  };
}

/**
 * Resolve which actor the task should be written under in the target workspace.
 *
 * @remarks
 * Same workspace: the routing actor, unchanged. Different workspace: the *same person's* actor
 * in the target, found through their linked user — and only if that actor is active. An actor
 * id is workspace-scoped, so carrying one across would be both a foreign key that does not
 * resolve and a tenancy hole. `undefined` means "this person cannot write here", which the
 * caller turns into a no-op; `null` means "nobody in particular", which lands unassigned.
 */
async function actorInTargetOrg(
  routingActorId: string | null,
  eventOrgId: string,
  targetOrgId: string,
): Promise<string | null | undefined> {
  if (targetOrgId === eventOrgId) return routingActorId;
  if (routingActorId === null) return undefined; // no identity to authorize a cross-org write
  const [source] = await db
    .select({ userId: actor.userId })
    .from(actor)
    .where(and(eq(actor.id, routingActorId), eq(actor.organizationId, eventOrgId)))
    .limit(1);
  if (!source?.userId) return undefined; // an agent actor, or not this org's actor at all
  const [target] = await db
    .select({ id: actor.id })
    .from(actor)
    .where(
      and(
        eq(actor.organizationId, targetOrgId),
        eq(actor.userId, source.userId),
        eq(actor.status, 'active'),
        isNull(actor.archivedAt),
      ),
    )
    .limit(1);
  return target?.id;
}

/** Apply the rule's field params to an existing task, org-scoped. Returns the task's id. */
async function applyParamsToTask(
  taskId: string,
  targetOrgId: string,
  params: RouteTaskParams,
): Promise<void> {
  const patch = {
    ...(params.state !== undefined ? { state: params.state } : {}),
    ...(params.priority !== undefined ? { priority: params.priority } : {}),
  };
  if (Object.keys(patch).length > 0) {
    await db
      .update(task)
      .set(patch)
      .where(and(eq(task.id, taskId), eq(task.organizationId, targetOrgId)));
  }
  if (params.labelId !== undefined) await attachLabel(taskId, targetOrgId, params.labelId);
}

/** Attach an org label to a task, refusing a label belonging to another workspace. */
async function attachLabel(taskId: string, orgId: string, labelId: string): Promise<void> {
  const [row] = await db
    .select({ id: label.id })
    .from(label)
    .where(and(eq(label.id, labelId), eq(label.organizationId, orgId)))
    .limit(1);
  if (!row) return; // not this workspace's label — no-op, never cross-tenant
  await db
    .insert(taskLabel)
    .values({ taskId, labelId, organizationId: orgId })
    .onConflictDoNothing();
}

/**
 * Raised inside the create transaction when the ledger insert hit the unique index: another
 * delivery of this same item routed it first.
 *
 * @remarks
 * A *thrown* sentinel rather than a returned flag, because only a throw rolls a Drizzle
 * transaction back. Both drivers this repo runs on commit whatever the callback returns —
 * postgres-js issues `commit` on the normal path and `rollback` only from its `catch`, and the
 * PGlite session delegates to the same contract. So returning "I lost the race" would leave the
 * task row this callback already inserted committed with no ledger row, no `created` event and
 * no search entry: precisely the orphan the one-item-one-task invariant exists to prevent.
 *
 * It is a dedicated class so the handler below can catch this one condition and nothing else. A
 * bare catch-all there would read a real database failure as a lost race and report `updated`
 * for a write that never happened.
 */
class InboundRouteRaceLost extends Error {
  constructor() {
    super('inbound route lost the insert race to a concurrent delivery');
    this.name = 'InboundRouteRaceLost';
  }
}

/** The route row for one item in one workspace, if the item has already been routed there. */
async function existingRoute(
  targetOrgId: string,
  item: InboundItem,
): Promise<{ id: string; taskId: string } | undefined> {
  const [row] = await db
    .select({ id: inboundTaskRoute.id, taskId: inboundTaskRoute.taskId })
    .from(inboundTaskRoute)
    .where(
      and(
        eq(inboundTaskRoute.organizationId, targetOrgId),
        eq(inboundTaskRoute.sourceSystem, item.sourceSystem),
        eq(inboundTaskRoute.sourceKey, item.sourceKey),
      ),
    )
    .limit(1);
  return row;
}

/** Whether a project id names a project in the target workspace. */
async function projectInOrg(projectId: string, orgId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.organizationId, orgId)))
    .limit(1);
  return row !== undefined;
}

/** Whether a task id names a live task in the target workspace (a stale link routes fresh). */
async function taskExistsIn(taskId: string, targetOrgId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: task.id })
    .from(task)
    .where(and(eq(task.id, taskId), eq(task.organizationId, targetOrgId), isNull(task.archivedAt)))
    .limit(1);
  return row !== undefined;
}

/**
 * Route one inbound item to a task in the target workspace: create it, or update the task the
 * item is already linked to. Never throws for a routing-configuration problem.
 *
 * @param event - The firing observation, projected into the engine's shape.
 * @param params - The rule's routing target.
 * @returns what happened, as data — the caller (the action handler) logs it.
 */
export async function routeInboundItemToTask(
  event: AutomationEvent,
  params: RouteTaskParams,
): Promise<RouteTaskOutcome> {
  const item =
    event.subjectType === 'email_suggestion'
      ? await mailItem(event)
      : event.source !== 'docket'
        ? externalItem(event)
        : null;
  if (!item) {
    // Distinguish "there was an item but we cannot key it" from "this was never an inbound
    // item", because only the first is worth a person's attention.
    if (event.subjectType === 'email_suggestion') {
      return { kind: 'skipped', reason: 'suggestion_unavailable' };
    }
    if (event.source !== 'docket' && event.externalId === undefined) {
      return { kind: 'skipped', reason: 'no_source_key' };
    }
    return { kind: 'skipped', reason: 'not_inbound' };
  }
  if (item.sourceKey.trim() === '') return { kind: 'skipped', reason: 'no_source_key' };

  const targetOrgId = params.organizationId ?? event.organizationId;
  const writerActorId = await actorInTargetOrg(item.actorId, event.organizationId, targetOrgId);
  if (writerActorId === undefined) return { kind: 'skipped', reason: 'not_a_member' };

  // Linkage, in the order that avoids duplicates. The ingestion layer's own resolution wins when
  // it produced one and it points somewhere live in this workspace; otherwise the routing ledger
  // answers, which is what makes a re-seen item and a second event about the same item converge.
  const linked =
    item.linkedTaskId !== null && (await taskExistsIn(item.linkedTaskId, targetOrgId))
      ? item.linkedTaskId
      : undefined;
  const route = await existingRoute(targetOrgId, item);
  const routedTaskId =
    route && (await taskExistsIn(route.taskId, targetOrgId)) ? route.taskId : undefined;
  const existingTaskId = linked ?? routedTaskId;

  if (existingTaskId !== undefined) {
    await applyParamsToTask(existingTaskId, targetOrgId, params);
    // Keep the ledger pointing at the task this item actually lives on, so a later delivery
    // short-circuits on the route row instead of re-resolving through the ingestion layer.
    await upsertRoute(targetOrgId, event.organizationId, existingTaskId, writerActorId, item);
    if (item.suggestionId !== null) await markSuggestionRouted(item, existingTaskId, event);
    await enqueueSearchUpsert(targetOrgId, 'task', existingTaskId);
    return { kind: 'updated', taskId: existingTaskId };
  }

  const landing = await resolveLandingTarget(targetOrgId, writerActorId);
  if (!landing) return { kind: 'skipped', reason: 'no_team' };
  // A project from another workspace is dropped rather than written: a task carrying a foreign
  // project id would be a tenancy leak wearing a foreign key.
  const projectId =
    params.projectId !== undefined && (await projectInOrg(params.projectId, targetOrgId))
      ? params.projectId
      : null;

  const created = await db
    .transaction(async (tx) => {
      const [taskRow] = await tx
        .insert(task)
        .values({
          organizationId: targetOrgId,
          title: item.title,
          description: item.description,
          teamId: params.teamId ?? landing.teamId,
          projectId,
          state: params.state ?? landing.state,
          priority: params.priority ?? item.priority ?? 'none',
          assigneeId: landing.assigneeId,
          cycleId: landing.cycleId,
          dueDate: item.dueDate ?? undefined,
          source: 'native',
          createdBy: writerActorId,
        })
        .returning();
      /* v8 ignore next -- @preserve defensive: insert always returns a row */
      if (!taskRow) throw new Error('routed task insert returned no row');

      // The ledger row and the task are one fact: a task with no route row would be re-created
      // by the next delivery, which is the duplicate this whole module exists to prevent. A
      // conflict means a concurrent route won the race — that writer's task is the real one, so
      // this throws {@link InboundRouteRaceLost} to roll the task and attachment inserts back.
      // Returning here would commit them instead: a normal return from a Drizzle transaction
      // callback is a `commit`, and only a throw is a `rollback`.
      const [routeRow] = await tx
        .insert(inboundTaskRoute)
        .values({
          organizationId: targetOrgId,
          createdBy: writerActorId,
          taskId: taskRow.id,
          sourceSystem: item.sourceSystem,
          sourceKey: item.sourceKey,
          sourceUrl: item.sourceUrl,
          sourceIntegrationId: item.integrationId,
          originOrganizationId: event.organizationId,
        })
        .onConflictDoNothing({
          target: [
            inboundTaskRoute.organizationId,
            inboundTaskRoute.sourceSystem,
            inboundTaskRoute.sourceKey,
          ],
        })
        .returning({ id: inboundTaskRoute.id });
      if (!routeRow) throw new InboundRouteRaceLost(); // another writer routed this item first

      // The source email rides along as the task's provenance: the thread a person can open, the
      // integration and thread id the `mail.*` actions later act through.
      let attachmentId: string | null = null;
      if (item.suggestionId !== null && item.sourceUrl !== null) {
        const meta = item.emailMeta as { subject?: string } | null;
        const [att] = await tx
          .insert(attachment)
          .values({
            organizationId: targetOrgId,
            createdBy: writerActorId,
            subjectType: 'task',
            subjectId: taskRow.id,
            kind: 'email',
            title: meta?.subject ?? item.title,
            url: item.sourceUrl,
            sourceIntegrationId: item.integrationId,
            externalId: item.sourceKey,
            metadata: item.emailMeta,
          })
          .returning({ id: attachment.id });
        attachmentId = att?.id ?? null;
      }
      return { taskRow, attachmentId };
    })
    // Only the race sentinel, and deliberately nothing else. A catch-all here would read a
    // genuine database failure — a bad foreign key, a dead connection — as "somebody beat me to
    // it" and report a confident `updated` for a write that never happened. Every other error
    // stays loud and reaches the caller.
    .catch((error: unknown) => {
      if (!(error instanceof InboundRouteRaceLost)) throw error;
      return null;
    });

  if (!created) {
    // Lost the race. The winner's task is the one task this item gets; adopt it.
    const winner = await existingRoute(targetOrgId, item);
    if (!winner) return { kind: 'skipped', reason: 'no_source_key' };
    await applyParamsToTask(winner.taskId, targetOrgId, params);
    return { kind: 'updated', taskId: winner.taskId };
  }

  if (params.labelId !== undefined)
    await attachLabel(created.taskRow.id, targetOrgId, params.labelId);
  if (item.suggestionId !== null) await markSuggestionRouted(item, created.taskRow.id, event);

  // The real event facade, not a private one: a routed task reaches the feed and search exactly
  // like a captured one, and this is the emit that any Athena assignment trigger watching this
  // workspace's work observes.
  await emitEvent({
    organizationId: targetOrgId,
    kind: 'created',
    actorId: writerActorId,
    title: created.taskRow.title,
    subject: { type: 'task', id: created.taskRow.id, title: created.taskRow.title },
    ...(item.sourceUrl !== null ? { permalink: item.sourceUrl } : {}),
  });
  await enqueueSearchUpsert(targetOrgId, 'task', created.taskRow.id);
  if (created.attachmentId !== null) {
    await enqueueSearchUpsert(targetOrgId, 'attachment', created.attachmentId);
  }

  return { kind: 'created', taskId: created.taskRow.id };
}

/** Write (or refresh) the ledger row linking this item to the task it routed to. */
async function upsertRoute(
  targetOrgId: string,
  originOrgId: string,
  taskId: string,
  writerActorId: string | null,
  item: InboundItem,
): Promise<void> {
  await db
    .insert(inboundTaskRoute)
    .values({
      organizationId: targetOrgId,
      createdBy: writerActorId,
      taskId,
      sourceSystem: item.sourceSystem,
      sourceKey: item.sourceKey,
      sourceUrl: item.sourceUrl,
      sourceIntegrationId: item.integrationId,
      originOrganizationId: originOrgId,
    })
    .onConflictDoUpdate({
      target: [
        inboundTaskRoute.organizationId,
        inboundTaskRoute.sourceSystem,
        inboundTaskRoute.sourceKey,
      ],
      set: { taskId, sourceUrl: item.sourceUrl, updatedAt: new Date() },
    });
}

/**
 * Close the suggestion the routed task came from.
 *
 * @remarks
 * A suggestion whose task exists is not still pending — leaving it in the review queue would ask
 * a person to accept something that already happened, and a later accept would create the second
 * task this module exists to prevent. Scoped to the suggestion's own workspace, which is the
 * event's, never the routing target's.
 */
async function markSuggestionRouted(
  item: InboundItem,
  taskId: string,
  event: AutomationEvent,
): Promise<void> {
  if (item.suggestionId === null) return;
  await db
    .update(emailSuggestion)
    .set({ status: 'accepted', createdTaskId: taskId })
    .where(
      and(
        eq(emailSuggestion.id, item.suggestionId),
        eq(emailSuggestion.organizationId, event.organizationId),
        eq(emailSuggestion.status, 'pending'),
      ),
    );
}
