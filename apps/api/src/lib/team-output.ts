import type { team } from '@docket/db';
import type { TeamOut } from '../contracts/team';
import type { z } from 'zod';

/** Project a Team row into its compact wire contract. */
export function teamOut(
  value: typeof team.$inferSelect,
  actorId?: string | null,
): z.input<typeof TeamOut> {
  return {
    id: value.id,
    ...(actorId ? { actorId } : {}),
    organizationId: value.organizationId,
    name: value.name,
    key: value.key,
    summary: value.summary ?? null,
    description: value.description ?? null,
    workflowStates: value.workflowStates,
    triageEnabled: value.triageEnabled,
    cycleCadenceDays: value.cycleCadenceDays,
    cycleCadenceAnchor: value.cycleCadenceAnchor,
    cycleCadenceRevision: value.cycleCadenceRevision,
    agentGuidance: value.agentGuidance ?? null,
    approvalRouting: value.approvalRouting ?? null,
  };
}
