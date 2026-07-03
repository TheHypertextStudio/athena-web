/**
 * `@docket/types` — Automation slice DTOs.
 *
 * @remarks
 * An automation rule is **data**, not code: `{ on, when, then }`. `on` matches an event
 * (by the observation `kind`/`subjectType` vocabulary already in the system), `when` is a
 * declarative {@link Predicate} (a Composite grammar interpreted against the event), and
 * `then` is an ordered list of {@link ActionSpec} commands dispatched to registered
 * handlers. The grammar here is fixed; the data it carries is open — adding a trigger,
 * condition, or action never edits these types. See
 * `docs/engineering/specs/email-to-task.md` §7.
 */
import { z } from 'zod';

import { AutomationRuleId, OrganizationId } from './primitives';

/** Scalar a predicate leaf compares against (paths resolve to JSON scalars). */
export const PredicateValue = z.union([z.string(), z.number(), z.boolean()]);
/** Predicate comparison value. */
export type PredicateValue = z.infer<typeof PredicateValue>;

/** Leaf comparison operators evaluated against a dotted path into the event. */
export const PredicateLeafOp = z.enum(['eq', 'neq', 'contains', 'gte', 'lte']);
/** Leaf operator value. */
export type PredicateLeafOp = z.infer<typeof PredicateLeafOp>;

/**
 * A declarative condition — a Composite tree of boolean nodes over event data.
 *
 * @remarks
 * `and`/`or` hold child predicates; `not` negates one; the leaf ops compare the JSON value
 * at `path` (e.g. `payload.category`) against `value`. The structure is recursive, so the
 * type is declared explicitly and the schema is built with `z.lazy`.
 */
export type Predicate =
  | { readonly op: 'and'; readonly nodes: readonly Predicate[] }
  | { readonly op: 'or'; readonly nodes: readonly Predicate[] }
  | { readonly op: 'not'; readonly node: Predicate }
  | { readonly op: PredicateLeafOp; readonly path: string; readonly value: PredicateValue };

/** Zod schema for {@link Predicate} (recursive via `z.lazy`). */
export const Predicate: z.ZodType<Predicate> = z.lazy(() =>
  z.union([
    z.object({ op: z.literal('and'), nodes: z.array(Predicate) }),
    z.object({ op: z.literal('or'), nodes: z.array(Predicate) }),
    z.object({ op: z.literal('not'), node: Predicate }),
    z.object({ op: PredicateLeafOp, path: z.string().min(1), value: PredicateValue }),
  ]),
);

/**
 * One action invocation — a Command: which handler (`type`) with what `params`.
 *
 * @remarks
 * The engine never interprets `type`; it looks the handler up in the Strategy registry. So
 * a new action (`mail.archive`, `suggestion.autoAccept`, `task.route`, …) is added by
 * registering a handler, never by editing this type.
 */
export const ActionSpec = z
  .object({
    type: z.string().min(1),
    params: z.record(z.string(), z.unknown()).default({}),
  })
  .meta({ id: 'ActionSpec', description: 'An automation action command.' });
/** Action command value. */
export type ActionSpec = z.infer<typeof ActionSpec>;

/**
 * The event-match (`on`): which events a rule reacts to. Absent fields match anything.
 *
 * @remarks
 * `kind`/`subjectType` address internal Docket events by their emit vocabulary
 * (`completed` × `task`). `source`/`entityKind` address events by origin and canonical kind —
 * the only handles external events (Linear, GitHub, Slack) carry, since they have no Docket
 * subject type ("any `work_item` completed from any source").
 */
export const AutomationEventMatch = z
  .object({
    kind: z.string().min(1).optional(),
    subjectType: z.string().min(1).optional(),
    source: z.string().min(1).optional(),
    entityKind: z.string().min(1).optional(),
  })
  .meta({ id: 'AutomationEventMatch', description: 'Event match for an automation rule.' });
/** Event-match value. */
export type AutomationEventMatch = z.infer<typeof AutomationEventMatch>;

/** A full automation rule as evaluated by the engine. */
export const AutomationRule = z
  .object({
    on: AutomationEventMatch,
    when: Predicate,
    then: z.array(ActionSpec),
  })
  .meta({ id: 'AutomationRule', description: 'An automation rule: on / when / then.' });
/** Automation rule value. */
export type AutomationRule = z.infer<typeof AutomationRule>;

/** Body for creating an automation rule. */
export const AutomationRuleCreate = z
  .object({
    name: z.string().min(1),
    enabled: z.boolean().default(true),
    on: AutomationEventMatch,
    when: Predicate,
    then: z.array(ActionSpec),
  })
  .meta({ id: 'AutomationRuleCreate', description: 'Create an automation rule.' });
/** Automation-rule-create value. */
export type AutomationRuleCreate = z.infer<typeof AutomationRuleCreate>;

/** Body for updating an automation rule (any subset of fields). */
export const AutomationRuleUpdate = z
  .object({
    name: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
    on: AutomationEventMatch.optional(),
    when: Predicate.optional(),
    then: z.array(ActionSpec).optional(),
  })
  .meta({ id: 'AutomationRuleUpdate', description: 'Update an automation rule.' });
/** Automation-rule-update value. */
export type AutomationRuleUpdate = z.infer<typeof AutomationRuleUpdate>;

/** Acknowledgement returned when an automation rule is removed. */
export const AutomationRuleRemoved = z
  .object({ id: AutomationRuleId, removed: z.literal(true) })
  .meta({ id: 'AutomationRuleRemoved', description: 'A removed-rule acknowledgement.' });
/** Removal acknowledgement value. */
export type AutomationRuleRemoved = z.infer<typeof AutomationRuleRemoved>;

/** Full automation-rule representation returned by reads. */
export const AutomationRuleOut = z
  .object({
    id: AutomationRuleId,
    organizationId: OrganizationId,
    name: z.string(),
    enabled: z.boolean(),
    on: AutomationEventMatch,
    when: Predicate,
    then: z.array(ActionSpec),
    isSeed: z.boolean(),
    createdAt: z.string(),
  })
  .meta({ id: 'AutomationRuleOut', description: 'An automation rule.' });
/** Automation-rule representation value. */
export type AutomationRuleOut = z.infer<typeof AutomationRuleOut>;
