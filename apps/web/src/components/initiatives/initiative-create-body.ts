import type { InitiativeCreate } from '@docket/work/initiative-contract';
import { ActorId } from '@docket/identity-access/ids';
import { serializeWorkTemplateSelection } from '@/components/composer/work-template-draft';
import type { InitiativeDraft } from './create-initiative';

/** Build one Initiative create input while preserving its template and planning timeframe. */
export function initiativeCreateBody(draft: InitiativeDraft, name: string): InitiativeCreate {
  return {
    ...serializeWorkTemplateSelection(draft),
    name,
    ...(draft.summary.trim() || draft.workTypeId ? { summary: draft.summary.trim() } : {}),
    ...(draft.description.trim() || draft.workTypeId
      ? { description: draft.description.trim() }
      : {}),
    ...(draft.ownerId ? { ownerId: ActorId.parse(draft.ownerId) } : {}),
    status: draft.status,
    priority: draft.priority,
    updateCadence: draft.updateCadence,
    ...(draft.health || draft.workTypeId ? { health: draft.health } : {}),
    ...(draft.targetTimeframe
      ? {
          targetDate: draft.targetTimeframe.date,
          targetDateResolution: draft.targetTimeframe.resolution,
        }
      : {}),
  };
}
