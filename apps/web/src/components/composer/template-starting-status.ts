import type { WorkStatusSetOut } from '@docket/work/work-status-contract';
import type { WorkTemplateOut } from '@docket/work/work-template-contract';

type StartingStatusSet = Pick<WorkStatusSetOut, 'entityType' | 'teamId'> & {
  readonly statuses: readonly Pick<
    WorkStatusSetOut['statuses'][number],
    'key' | 'name' | 'isDefault'
  >[];
};

/** Resolve a publication default against the destination kind and team workflow. */
export function templateStartingStatus(
  template: Pick<WorkTemplateOut, 'targetType' | 'definition'>,
  sets: readonly StartingStatusSet[],
  teamId: string | null,
): string | undefined {
  const kind = template.targetType;
  const available =
    (kind === 'task'
      ? sets.find((set) => set.entityType === kind && set.teamId === teamId)
      : undefined) ?? sets.find((set) => set.entityType === kind && set.teamId === null);
  const payload = template.definition.payload;
  const desired =
    template.definition.defaultStatusKey ??
    (payload.targetType === 'task' ? payload.state : payload.status);
  const status =
    available?.statuses.find(
      (item) => item.key === desired || item.name.toLowerCase() === desired?.toLowerCase(),
    ) ?? available?.statuses.find((item) => item.isDefault);
  return status?.key;
}
