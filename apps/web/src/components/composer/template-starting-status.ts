import type { WorkStatusSetOut } from '@docket/work/work-status-contract';
import type { WorkTemplateOut } from '@docket/work/work-template-contract';

/** Resolve a publication default against the destination kind and team workflow. */
export function templateStartingStatus(
  template: WorkTemplateOut,
  sets: readonly WorkStatusSetOut[],
  teamId: string | null,
): string | undefined {
  const kind = template.targetType;
  const available =
    (kind === 'task'
      ? sets.find((set) => set.entityType === kind && set.teamId === teamId)
      : undefined) ?? sets.find((set) => set.entityType === kind && set.teamId === null);
  const desired =
    template.definition.defaultStatusKey ??
    ('status' in template.definition.payload ? template.definition.payload.status : undefined);
  const status =
    available?.statuses.find((item) => item.key === desired) ??
    available?.statuses.find((item) => item.isDefault);
  return status?.key;
}
