import type { automationRule } from '@docket/db';
import { AutomationRule, type ActionSpec } from '@docket/automation/contracts';
import { evaluatePredicate, matchesAutomationEvent } from '@docket/automation/evaluation';
import { CapabilityError } from '../../error';
import { blueprintFingerprint } from '../work-template-blueprints/fingerprint';

/** Opaque immutable source identity issued when the runtime loads a persisted rule. */
export interface AutomationRuleExecution {
  readonly kind: 'automation-rule';
  readonly proof: object;
}
/** Opaque exact action/event binding; attribution does not grant its authority. */
export interface AutomationActionExecution {
  readonly kind: 'automation-action';
  readonly proof: object;
}
type RuleRow = typeof automationRule.$inferSelect;
interface RuleFacts {
  readonly organizationId: string;
  readonly id: string;
  readonly fingerprint: string;
  readonly definition: AutomationRule;
}
/** Immutable checked action facts, available only through the original registered object identity. */
export interface AutomationActionFacts {
  readonly rule: RuleFacts;
  readonly event: unknown;
  readonly index: number;
  readonly action: ActionSpec;
}
const rules = new WeakMap<AutomationRuleExecution, RuleFacts>();
const actions = new WeakMap<AutomationActionExecution, AutomationActionFacts>();
/** Fingerprint every persisted permission/source field used for exact execution. */
export function automationSourceFingerprint(row: RuleRow): string {
  return blueprintFingerprint({
    organizationId: row.organizationId,
    id: row.id,
    createdBy: row.createdBy,
    enabled: row.enabled,
    archivedAt: row.archivedAt,
    isSeed: row.isSeed,
    eventMatch: row.eventMatch,
    condition: row.condition,
    actions: row.actions,
  });
}
/** Bind a runtime projection to the persisted rule's exact immutable source snapshot. */
export function registerAutomationRuleExecution(row: RuleRow): AutomationRuleExecution {
  const token: AutomationRuleExecution = Object.freeze({ kind: 'automation-rule', proof: {} });
  const definition = AutomationRule.parse({
    on: row.eventMatch,
    when: row.condition,
    then: row.actions,
  });
  rules.set(token, {
    organizationId: row.organizationId,
    id: row.id,
    fingerprint: automationSourceFingerprint(row),
    definition: structuredClone(definition),
  });
  return token;
}
/** Bind one exact engine-dispatched action slot to its original matching event. */
export function bindAutomationActionExecution(
  token: AutomationRuleExecution,
  event: unknown,
  index: number,
  action: ActionSpec,
): AutomationActionExecution {
  const facts = rules.get(token);
  const expected = facts?.definition.then[index];
  if (
    !facts ||
    !expected ||
    blueprintFingerprint(expected) !== blueprintFingerprint(action) ||
    !matchesAutomationEvent(facts.definition.on, event) ||
    !evaluatePredicate(facts.definition.when, event)
  )
    throw new CapabilityError();
  const bound: AutomationActionExecution = Object.freeze({ kind: 'automation-action', proof: {} });
  actions.set(bound, {
    rule: facts,
    event: structuredClone(event),
    index,
    action: structuredClone(action),
  });
  return bound;
}
/** Require the original opaque action capability before any persisted-source revalidation. */
export function requireAutomationActionExecution(
  token: AutomationActionExecution,
): AutomationActionFacts {
  const facts = actions.get(token);
  if (!facts) throw new CapabilityError();
  return facts;
}
