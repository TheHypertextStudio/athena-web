/**
 * Declarative grammar for a portable Automation Rule.
 *
 * @remarks
 * A rule is data rather than executable code: `on` matches an event, `when` describes a
 * predicate over that event, and `then` names ordered action commands. Delivery runtimes own
 * action handlers and dispatch; this module owns only the shared language those runtimes read.
 */
import { z } from 'zod';

/** Scalar a predicate leaf compares against after resolving a path in an event. */
export const PredicateValue = z.union([z.string(), z.number(), z.boolean()]);
/** Predicate comparison value. */
export type PredicateValue = z.infer<typeof PredicateValue>;

/** Leaf comparison operators evaluated against a dotted path into an event. */
export const PredicateLeafOp = z.enum(['eq', 'neq', 'contains', 'gte', 'lte']);
/** Predicate leaf operator. */
export type PredicateLeafOp = z.infer<typeof PredicateLeafOp>;

/**
 * A declarative condition: a composite tree of boolean nodes over event data.
 *
 * @remarks
 * `and` and `or` hold child predicates, `not` negates one child, and each leaf compares the
 * scalar at `path` (for example `payload.category`) with `value`.
 */
export type Predicate =
  | { readonly op: 'and'; readonly nodes: readonly Predicate[] }
  | { readonly op: 'or'; readonly nodes: readonly Predicate[] }
  | { readonly op: 'not'; readonly node: Predicate }
  | { readonly op: PredicateLeafOp; readonly path: string; readonly value: PredicateValue };

/** Zod schema for a recursive {@link Predicate}. */
export const Predicate: z.ZodType<Predicate> = z.lazy(() =>
  z.union([
    z.object({ op: z.literal('and'), nodes: z.array(Predicate) }),
    z.object({ op: z.literal('or'), nodes: z.array(Predicate) }),
    z.object({ op: z.literal('not'), node: Predicate }),
    z.object({ op: PredicateLeafOp, path: z.string().min(1), value: PredicateValue }),
  ]),
);

/** One named action command and its open parameters. */
export const ActionSpec = z
  .object({
    type: z.string().min(1),
    params: z.record(z.string(), z.unknown()).default({}),
  })
  .meta({ id: 'ActionSpec', description: 'An automation action command.' });
/** Action command value. */
export type ActionSpec = z.infer<typeof ActionSpec>;

/**
 * The event match that determines whether a rule may react to an event.
 *
 * @remarks
 * Every absent field is a wildcard. `kind` and `subjectType` address internal events;
 * `source` and `entityKind` make the same language applicable to externally observed events.
 */
export const AutomationEventMatch = z
  .object({
    kind: z.string().min(1).optional(),
    subjectType: z.string().min(1).optional(),
    source: z.string().min(1).optional(),
    entityKind: z.string().min(1).optional(),
  })
  .meta({ id: 'AutomationEventMatch', description: 'Event match for an automation rule.' });
/** Event match value. */
export type AutomationEventMatch = z.infer<typeof AutomationEventMatch>;

/** A complete portable Automation Rule as interpreted by a delivery runtime. */
export const AutomationRule = z
  .object({
    on: AutomationEventMatch,
    when: Predicate,
    then: z.array(ActionSpec),
  })
  .meta({ id: 'AutomationRule', description: 'An automation rule: on / when / then.' });
/** Automation Rule value. */
export type AutomationRule = z.infer<typeof AutomationRule>;
