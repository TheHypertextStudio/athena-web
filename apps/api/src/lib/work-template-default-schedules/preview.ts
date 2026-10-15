import {
  BlueprintError,
  type BlueprintCreationContext,
  type PlannedWorkTree,
} from '@docket/work/blueprints';
import { WorkScheduleTrigger } from '@docket/work/work-schedule-trigger';
import type { ProgramDefaultSchedulePreview } from '@docket/work/work-template-blueprint';
import { CapabilityError } from '../../error';
import type { TemplateTransaction } from '../templates/persistence';
import type { OrdinaryWorkCommand } from '../work-creation/types';
import { compileScheduleCommand } from '../recurrence/schedule-compiler';
import { preflightScheduleClaim } from '../recurrence/schedule-preflight';
import { firstScheduleRunDate } from '../recurrence/schedule-review-date';
import { programScheduleCopies } from './install';

/** Validate future templates and assignments, then summarize selected Program defaults without writes. */
export async function previewProgramDefaultSchedules(
  tx: TemplateTransaction,
  command: OrdinaryWorkCommand,
  tree: PlannedWorkTree,
  context: BlueprintCreationContext,
): Promise<ProgramDefaultSchedulePreview[]> {
  const summaries: ProgramDefaultSchedulePreview[] = [];
  for (const node of tree.nodes.filter((item) => item.selected && item.kind === 'program')) {
    for (const copy of programScheduleCopies(node, context)) {
      if (command.caller.actorId === null) throw new CapabilityError();
      const date = firstScheduleRunDate(
        WorkScheduleTrigger.parse({ kind: 'calendar', schedule: copy.cadence }),
        copy.cadence.startDate,
      );
      if (!date)
        throw new BlueprintError('blueprint_invalid', 'The default schedule has no future run.');
      // Preview can validate the future work without inventing authority for an uncreated Program.
      // Installation rechecks its actual generated Program destination and Manage permission.
      await preflightScheduleClaim(
        tx,
        compileScheduleCommand({
          caller: command.caller,
          seriesId: 'default-schedule-preview',
          ownerProgramId: null,
          runDate: date,
          document: copy.document,
        }),
        copy.document,
      );
      const template = copy.document.template;
      summaries.push({
        programPath: [...node.path],
        programName: 'name' in node.fields ? (node.fields.name ?? '') : '',
        key: copy.key,
        name: copy.name,
        targetType: template.targetType,
        workTypeId: template.workTypeId,
        selection: template.selection.kind,
        workTypeVersionId:
          template.selection.kind === 'pinned' ? template.selection.workTypeVersionId : null,
        titlePattern: copy.document.titlePattern,
        cadenceKind: copy.cadence.kind,
        interval: copy.cadence.interval,
        firstRunDate: date,
        timezone: copy.document.timezone,
      });
    }
  }
  return summaries;
}
