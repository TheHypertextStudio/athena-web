/**
 * `lib/plan-draft/context` — the plan a conversation is shaping, as the system prompt describes it.
 */
import { planCounts } from '@docket/work/plan-draft';

import type { ActivePlanContext } from '../../agent/system-prompt';
import { activePlanForSession } from './store';

/** The plan this conversation is shaping on the canvas, or null when it has none. */
export async function activePlanContext(sessionId: string): Promise<ActivePlanContext | null> {
  const plan = await activePlanForSession(sessionId);
  if (!plan) return null;
  return {
    id: plan.id,
    title: plan.title,
    revision: plan.revision,
    counts: planCounts(plan.document),
  };
}
