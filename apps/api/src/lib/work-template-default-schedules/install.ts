import { instantiateDefaultScheduleCopy } from '@docket/work/work-schedule-defaults';
import { WorkScheduleTrigger } from '@docket/work/work-schedule-trigger';
import { WorkScheduleDraft } from '@docket/work/work-schedule';
import type { CalendarRecurrenceSchedule } from '@docket/work/recurrence';
import type { PlannedWorkNode, BlueprintCreationContext } from '@docket/work/blueprints';
import { CapabilityError } from '../../error';
import type { TemplateTransaction } from '../templates/persistence';
import { createWorkScheduleInTransaction } from '../recurrence/schedule-authoring';
import type { PreparedBlueprintCreation } from '../work-template-blueprints/preflight';
import type { InsertedWork } from '../work-creation/writers';
import { programDefaultScheduleChange } from '../../mcp/change-set-program-schedules';
import type { StoredChange } from '../../mcp/change-set';

/** Concrete private copy ready to undergo the native schedule writer's live preflight. */
export interface ProgramScheduleCopy {
  readonly key: string;
  readonly name: string;
  readonly cadence: CalendarRecurrenceSchedule;
  readonly document: WorkScheduleDraft;
}

/** Instantiate one independent private schedule using authorized actual parent assignments. */
export function programScheduleCopies(
  node: PlannedWorkNode,
  context: BlueprintCreationContext,
): ProgramScheduleCopy[] {
  return (node.definition?.defaultSchedules ?? []).map((outline) => {
    const copy = instantiateDefaultScheduleCopy(outline, node, context);
    return {
      key: outline.key,
      name: outline.name,
      cadence: copy.cadence,
      document: WorkScheduleDraft.parse({
        kind: 'schedule',
        revision: 1,
        template: outline.template,
        titlePattern: outline.titlePattern,
        timezone: context.timezone,
        root: copy.root,
        stepOverrides: [],
        optionalChoices: [],
      }),
    };
  });
}

/** Install defaults only for newly inserted Programs; failed preflight rolls back the enclosing work tree. */
export async function installProgramDefaultSchedules(
  tx: TemplateTransaction,
  prepared: PreparedBlueprintCreation,
  created: readonly InsertedWork[],
): Promise<StoredChange[]> {
  const changes: StoredChange[] = [];
  const ids = new Set(created.filter((work) => work.kind === 'program').map((work) => work.id));
  for (const entry of prepared.entries) {
    if (entry.kind === 'existing' || !ids.has(entry.allocated.id)) continue;
    const node = entry.allocated.node;
    if (node.kind !== 'program') continue;
    const copies = programScheduleCopies(node, prepared.context);
    if (!copies.length) continue;
    const actorId = prepared.command.caller.actorId;
    if (actorId === null) throw new CapabilityError();
    for (const copy of copies) {
      const created = await createWorkScheduleInTransaction(tx, {
        organizationId: prepared.command.caller.orgId,
        actorId,
        ownerProgramId: entry.allocated.id,
        name: copy.name,
        document: copy.document,
        trigger: WorkScheduleTrigger.parse({ kind: 'calendar', schedule: copy.cadence }),
        effectiveFrom: copy.cadence.startDate,
      });
      changes.push(programDefaultScheduleChange(created));
    }
  }
  return changes;
}
