import type { ProgramCreate } from '@docket/work/program-contract';
import { ActorId } from '@docket/identity-access/ids';
import { serializeWorkTemplateSelection } from '@/components/composer/work-template-draft';
import type { ProgramDraft } from './create-program';

/** Build one Program create input without losing its chosen published template. */
export function programCreateBody(draft: ProgramDraft, name: string): ProgramCreate {
  return {
    ...serializeWorkTemplateSelection(draft),
    name,
    ...(draft.summary.trim() || draft.workTypeId ? { summary: draft.summary.trim() } : {}),
    ...(draft.description.trim() || draft.workTypeId
      ? { description: draft.description.trim() }
      : {}),
    ...(draft.ownerId ? { ownerId: ActorId.parse(draft.ownerId) } : {}),
    status: draft.status,
    ...(draft.health || draft.workTypeId ? { health: draft.health } : {}),
    visibility: draft.visibility,
  };
}
