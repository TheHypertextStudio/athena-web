import { automationRule, task } from '@docket/db';
import { AutomationRule } from '@docket/automation/contracts';
import { evaluatePredicate, matchesAutomationEvent } from '@docket/automation/evaluation';
import { and, eq, isNull } from 'drizzle-orm';
import type { ActorCtx } from '../../context';
import { CapabilityError } from '../../error';
import type { TemplateTransaction } from '../templates/persistence';
import { loadCreationActor } from '../work-creation/context';
import { blueprintFingerprint } from '../work-template-blueprints/fingerprint';
import {
  requireAutomationActionExecution,
  automationSourceFingerprint,
  type AutomationActionFacts,
  type AutomationActionExecution,
} from './execution-proof';
export type { AutomationActionExecution } from './execution-proof';

/** Exact task transition addressed by a checked action; this is an internal invocation, never a DTO. */
export interface AutomationStateTarget {
  readonly organizationId: string;
  readonly taskId: string;
  readonly state: string;
}
function assertActionTarget(facts: AutomationActionFacts, target: AutomationStateTarget): void {
  const event = facts.event;
  if (
    typeof event !== 'object' ||
    event === null ||
    !('organizationId' in event) ||
    event.organizationId !== target.organizationId ||
    !('subjectType' in event) ||
    event.subjectType !== 'task' ||
    !('subjectId' in event) ||
    event.subjectId !== target.taskId ||
    facts.rule.organizationId !== target.organizationId ||
    facts.action.type !== 'task.setStatus' ||
    facts.action.params['state'] !== target.state
  )
    throw new CapabilityError();
}
/** Revalidate persisted source and actual author inside the state transaction, retaining nullable attribution separately. */
export async function authorizeAutomationTaskState(
  tx: TemplateTransaction,
  token: AutomationActionExecution,
  target: AutomationStateTarget,
): Promise<ActorCtx> {
  const facts = requireAutomationActionExecution(token);
  assertActionTarget(facts, target);
  const [row] = await tx
    .select()
    .from(automationRule)
    .where(
      and(
        eq(automationRule.id, facts.rule.id),
        eq(automationRule.organizationId, target.organizationId),
        eq(automationRule.enabled, true),
        isNull(automationRule.archivedAt),
      ),
    )
    .limit(1)
    .for('share');
  // Shipped system seeds contain no task.setStatus scope. Editable isSeed alone never grants authority.
  if (!row?.createdBy || automationSourceFingerprint(row) !== facts.rule.fingerprint)
    throw new CapabilityError();
  const current = AutomationRule.parse({
    on: row.eventMatch,
    when: row.condition,
    then: row.actions,
  });
  if (
    blueprintFingerprint(current.then[facts.index]) !== blueprintFingerprint(facts.action) ||
    !matchesAutomationEvent(current.on, facts.event) ||
    !evaluatePredicate(current.when, facts.event)
  )
    throw new CapabilityError();
  const [targetRow] = await tx
    .select({ id: task.id })
    .from(task)
    .where(
      and(
        eq(task.organizationId, target.organizationId),
        eq(task.id, target.taskId),
        isNull(task.archivedAt),
      ),
    )
    .limit(1);
  if (!targetRow) throw new CapabilityError();
  return loadCreationActor(tx, target.organizationId, row.createdBy);
}
