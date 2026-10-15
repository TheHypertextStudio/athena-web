import { ProgramDefaultSchedule } from '@docket/work/work-schedule-defaults';
import { relativeCadence } from '@/components/recurrence/relative-repeat-draft';
import type { WorkTemplateOut } from '@docket/work/work-template-contract';

/** Start a reusable routine only after a published Task or Project identity is chosen. */
export function defaultScheduleForTemplate(
  template: WorkTemplateOut,
  existing?: ProgramDefaultSchedule,
): ProgramDefaultSchedule | null {
  if (
    (template.targetType !== 'task' && template.targetType !== 'project') ||
    !template.latestVersion
  )
    return null;
  const identity = {
    targetType: template.targetType,
    workTypeId: template.id,
    selection: { kind: 'latest' as const },
  };
  if (existing) return { ...existing, template: identity };
  return ProgramDefaultSchedule.parse({
    key: `schedule-${crypto.randomUUID()}`,
    name: template.definition.name.slice(0, 120),
    template: identity,
    titlePattern: initialTitle(template),
    cadence: relativeCadence('monthly'),
    teamRule: 'parent_team',
    actorRule: 'parent_responsible',
  });
}

/** Reorder stable routine identities without changing any existing Program copies. */
export function moveDefaultSchedule(
  values: readonly ProgramDefaultSchedule[],
  key: string,
  direction: -1 | 1,
): ProgramDefaultSchedule[] {
  const index = values.findIndex((value) => value.key === key);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= values.length) return [...values];
  const result = [...values];
  const item = result.splice(index, 1)[0];
  if (item) result.splice(next, 0, item);
  return result;
}

function initialTitle(template: WorkTemplateOut): string {
  const payload = template.definition.payload;
  const title = 'title' in payload ? payload.title : 'name' in payload ? payload.name : undefined;
  return title?.trim() ? title : template.definition.name;
}
