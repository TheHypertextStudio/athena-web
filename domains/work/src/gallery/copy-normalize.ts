import { BlueprintError } from '../blueprints/errors';
import { WorkTemplateDefinition } from '../contracts/work-template';
import { ProgramDefaultSchedules } from '../contracts/work-schedule-defaults';
import { copyFacts } from './copy-facts';

/** Normalize catalog sibling defaults without changing canonical bodies or silently choosing conflicting facts. */
export function normalizeCopyDefinition(
  definition: WorkTemplateDefinition,
  defaultSchedules: readonly ProgramDefaultSchedules[number][] = [],
): WorkTemplateDefinition {
  const parsed = WorkTemplateDefinition.parse(definition);
  const sibling = ProgramDefaultSchedules.parse(defaultSchedules);
  if (
    sibling.length &&
    parsed.defaultSchedules.length &&
    copyFacts(sibling) !== copyFacts(parsed.defaultSchedules)
  )
    throw new BlueprintError(
      'blueprint_invalid',
      'Conflicting canonical and sibling Program schedules.',
    );
  return WorkTemplateDefinition.parse({
    ...parsed,
    defaultSchedules: sibling.length ? sibling : parsed.defaultSchedules,
  });
}
