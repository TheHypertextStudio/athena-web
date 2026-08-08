/**
 * `@docket/api` — the engine-visible projection of one committed event, and the pure
 * projection functions both event write paths use to produce it.
 *
 * @remarks
 * The automation engine never reads the `event` table row or the emit input directly; both
 * write paths (the internal emit Facade and the external webhook drain) are projected into
 * this one shape before rules run. Predicate paths (`when`) resolve into it — e.g.
 * `detail.category`, `kind`, `entityKind` — and the `on` matcher compares its `kind`,
 * `subjectType`, `source`, and `entityKind` fields. This module is deliberately pure (no db,
 * no connectors, no env) so the projection contract is testable in isolation. See
 * `docs/engineering/specs/automations.md`.
 */
import { DOCKET_ENTITY_KIND } from '@docket/types';

import type { EmitEventInput } from '../../routes/event-emit';

/** The engine-visible projection of one committed event. */
export interface AutomationEvent {
  readonly organizationId: string;
  /** The canonical event verb (`created` | `completed` | `status_change` | …). */
  readonly kind: string;
  /** Which tool produced the event (`docket` | `linear` | `github` | `slack` | …). */
  readonly source: string;
  /**
   * The Docket entity type (`task` | `email_suggestion` | `project` | …). Present for
   * internal emits; present on external events only when the entity resolved to a Docket one.
   */
  readonly subjectType?: string;
  /** The Docket entity id, when {@link subjectType} is present. */
  readonly subjectId?: string;
  /** The canonical entity kind (`work_item` | `project` | …), when known. */
  readonly entityKind?: string;
  /** The subject's display title, when known. */
  readonly subjectTitle?: string;
  /**
   * The external identity of the thing the event is about, for events that came from another
   * tool — a GitHub pull request's id, a Linear issue's id.
   *
   * @remarks
   * The *entity's* id, deliberately not the delivery's. A pull request that is opened and later
   * closed arrives as two events carrying two `dedupeKey`s and one `externalId`, which is what
   * lets `task.route` recognize the second event as being about the task the first one created.
   * Absent for internal Docket events, which address their subject by `subjectId` instead.
   */
  readonly externalId?: string;
  /** Canonical open-in-source URL for the subject, when the provider gave one. */
  readonly externalUrl?: string;
  /**
   * The event's typed detail pocket flattened to a record (paths like `detail.category`,
   * `detail.toState`). Always present; empty when the event carried no detail.
   */
  readonly detail: Readonly<Record<string, unknown>>;
  /** The acting Docket actor id, when known. */
  readonly actorId?: string;
  /** The firing time — injectable, never `Date.now()` inside handlers. */
  readonly occurredAt: Date;
}

/** Docket subject types by canonical entity kind (the reverse of {@link DOCKET_ENTITY_KIND}). */
const DOCKET_SUBJECT_TYPE: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(DOCKET_ENTITY_KIND).map(([subjectType, entityKind]) => [entityKind, subjectType]),
);

/** Project an internal {@link EmitEventInput} (post-commit) into the engine shape. */
export function projectEmitInput(input: EmitEventInput, occurredAt: Date): AutomationEvent {
  const entityKind = DOCKET_ENTITY_KIND[input.subject.type];
  return {
    organizationId: input.organizationId,
    kind: input.kind,
    source: 'docket',
    subjectType: input.subject.type,
    subjectId: input.subject.id,
    ...(entityKind !== undefined && { entityKind }),
    ...(input.subject.title !== undefined && { subjectTitle: input.subject.title }),
    detail: input.detail ? { ...input.detail } : {},
    ...(input.actorId != null && { actorId: input.actorId }),
    occurredAt,
  };
}

/** The just-committed values of one drained external event, as the drain holds them. */
export interface InboundEventProjectionInput {
  readonly organizationId: string;
  readonly kind: string;
  /** The event's source system (`linear` | `github` | `slack` | …). */
  readonly source: string;
  readonly entityKind: string | null;
  /** The Docket entity the external entity resolved to, when enrichment resolved one. */
  readonly docketEntityId: string | null;
  /** The subject's native id in the source system, when the draft carried a subject. */
  readonly externalId?: string | null;
  /** The subject's canonical source URL (the draft's permalink), when the provider gave one. */
  readonly externalUrl?: string | null;
  readonly title: string;
  readonly detail: unknown;
  readonly occurredAt: Date;
}

/**
 * Project one drained external event into the engine shape.
 *
 * @remarks
 * External events carry no Docket subject type; `subjectType`/`subjectId` are present only
 * when the entity resolved to a Docket one AND its canonical kind reverse-maps to a Docket
 * subject type. Rules address unresolved external events via `source`/`entityKind`/`detail.*`.
 */
export function projectInboundDraft(input: InboundEventProjectionInput): AutomationEvent {
  const subjectType =
    input.docketEntityId !== null && input.entityKind !== null
      ? DOCKET_SUBJECT_TYPE[input.entityKind]
      : undefined;
  const detail =
    typeof input.detail === 'object' && input.detail !== null
      ? { ...(input.detail as Record<string, unknown>) }
      : {};
  return {
    organizationId: input.organizationId,
    kind: input.kind,
    source: input.source,
    ...(subjectType !== undefined &&
      input.docketEntityId !== null && { subjectType, subjectId: input.docketEntityId }),
    ...(input.entityKind !== null && { entityKind: input.entityKind }),
    subjectTitle: input.title,
    ...(input.externalId != null && { externalId: input.externalId }),
    ...(input.externalUrl != null && { externalUrl: input.externalUrl }),
    detail,
    occurredAt: input.occurredAt,
  };
}
