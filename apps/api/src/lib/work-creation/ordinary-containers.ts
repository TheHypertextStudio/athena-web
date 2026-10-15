import { actor, program, team } from '@docket/db';
import { InitiativeCreate } from '@docket/work/initiative-contract';
import { ProgramCreate } from '@docket/work/program-contract';
import { ProjectCreate } from '../../contracts/project';
import { assertRefInOrg } from '../../routes/task-helpers';
import { guardsInOrder } from '../guards-in-order';
import { resolveLabelSet } from '../labels';
import { assertPlanningDateRange, planningDatePatch } from '../planning-timeframe';
import type { TemplateTransaction } from '../templates/persistence';
import { ordinaryCreationDefaults } from './ordinary-defaults';
import { resolveContainerStatus } from '../work-status';
import { creationFiscalMonth, validatedInitiativeIds } from './ordinary-references';
import { prospectiveWorkReference } from './ordinary-prospective';
import type {
  OrdinaryWorkCommand,
  PreparedOrdinaryWork,
  OrdinaryPreparationContext,
} from './types';

/** Prepare an ordinary Project with its labels, fiscal dates and explicit checkpoints. */
export async function prepareOrdinaryProject(
  tx: TemplateTransaction,
  command: Extract<OrdinaryWorkCommand, { kind: 'project' }>,
  context?: OrdinaryPreparationContext,
): Promise<PreparedOrdinaryWork> {
  const { orgId, actorId } = command.caller;
  const body = ProjectCreate.parse(await ordinaryCreationDefaults(tx, command, context));
  await guardsInOrder([
    assertRefInOrg(actor, orgId, body.leadId, 'Lead not found', tx),
    assertRefInOrg(team, orgId, body.teamId, 'Team not found', tx),
    ...(prospectiveWorkReference(tx, command, context, 'program', body.programId)
      ? []
      : [assertRefInOrg(program, orgId, body.programId, 'Program not found', tx)]),
  ]);
  const status = await resolveContainerStatus(
    orgId,
    'project',
    body.status ?? 'planned',
    'status',
    tx,
  );
  const initiativeIds = await creationInitiatives(tx, command, body.initiativeIds, context);
  const labels = await resolveLabelSet(orgId, body.labelIds, { teamId: body.teamId, dbh: tx });
  const dates = await projectDates(tx, orgId, body);
  return {
    command,
    labels,
    initiativeIds,
    milestones: body.milestones ?? [],
    relatedTaskIds: [],
    insert: {
      kind: 'project',
      values: {
        organizationId: orgId,
        workTypeId: body.workTypeId,
        workTypeVersionId: body.workTypeVersionId,
        name: body.name,
        summary: body.summary,
        description: body.description,
        leadId: body.leadId,
        teamId: body.teamId,
        programId: body.programId,
        status: status.status,
        statusId: status.statusId,
        health: body.health,
        priority: body.priority,
        ...dates,
        visibility:
          context?.rootVisibility === 'private'
            ? 'private'
            : command.invocation.placement?.visibility,
        createdBy: actorId,
      },
    },
  };
}

/** Prepare an ordinary Initiative using the existing owner, status, label and broad-date rules. */
export async function prepareOrdinaryInitiative(
  tx: TemplateTransaction,
  command: Extract<OrdinaryWorkCommand, { kind: 'initiative' }>,
  context?: OrdinaryPreparationContext,
): Promise<PreparedOrdinaryWork> {
  const { orgId, actorId } = command.caller;
  const body = InitiativeCreate.parse(await ordinaryCreationDefaults(tx, command, context));
  await assertRefInOrg(actor, orgId, body.ownerId, 'Owner not found', tx);
  const labels = await resolveLabelSet(orgId, body.labelIds, { dbh: tx });
  const status = await resolveContainerStatus(
    orgId,
    'initiative',
    body.status ?? 'active',
    'status',
    tx,
  );
  const target = planningDatePatch(
    { date: body.targetDate, resolution: body.targetDateResolution },
    await creationFiscalMonth(orgId, tx),
    'target',
    'targetDate',
    'targetDateResolution',
  );
  return {
    command,
    labels,
    initiativeIds: [],
    milestones: [],
    relatedTaskIds: [],
    insert: {
      kind: 'initiative',
      values: {
        organizationId: orgId,
        workTypeId: body.workTypeId,
        workTypeVersionId: body.workTypeVersionId,
        name: body.name,
        summary: body.summary,
        description: body.description,
        ownerId: body.ownerId,
        status: status.status,
        statusId: status.statusId,
        priority: body.priority ?? 'none',
        updateCadence: body.updateCadence ?? 'monthly',
        ...(target === undefined
          ? {}
          : {
              targetDate: target.date,
              targetDateResolution: target.resolution,
              targetDateFiscalYearStartMonth: target.fiscalYearStartMonth,
            }),
        health: body.health,
        createdBy: actorId,
      },
    },
  };
}

/** Prepare an ordinary Program while retaining its administrative create threshold and privacy. */
export async function prepareOrdinaryProgram(
  tx: TemplateTransaction,
  command: Extract<OrdinaryWorkCommand, { kind: 'program' }>,
  context?: OrdinaryPreparationContext,
): Promise<PreparedOrdinaryWork> {
  const { orgId, actorId } = command.caller;
  const body = ProgramCreate.parse(await ordinaryCreationDefaults(tx, command, context));
  await assertRefInOrg(actor, orgId, body.ownerId, 'Owner not found', tx);
  const status = await resolveContainerStatus(
    orgId,
    'program',
    body.status ?? 'active',
    'status',
    tx,
  );
  const labels = await resolveLabelSet(orgId, command.invocation.labelIds, { dbh: tx });
  const initiativeIds = await creationInitiatives(
    tx,
    command,
    command.invocation.placement?.initiativeId ? [command.invocation.placement.initiativeId] : [],
    context,
  );
  return {
    command,
    labels,
    initiativeIds,
    milestones: [],
    relatedTaskIds: [],
    insert: {
      kind: 'program',
      values: {
        organizationId: orgId,
        workTypeId: body.workTypeId,
        workTypeVersionId: body.workTypeVersionId,
        name: body.name,
        summary: body.summary,
        description: body.description,
        ownerId: body.ownerId,
        status: status.status,
        statusId: status.statusId,
        health: body.health,
        visibility:
          context?.rootVisibility === 'private' ? 'private' : (body.visibility ?? 'public'),
        createdBy: actorId,
      },
    },
  };
}

async function projectDates(tx: TemplateTransaction, orgId: string, body: ProjectCreate) {
  const fiscalMonth = await creationFiscalMonth(orgId, tx);
  const start = planningDatePatch(
    { date: body.startDate, resolution: body.startDateResolution },
    fiscalMonth,
    'start',
    'startDate',
    'startDateResolution',
  );
  const target = planningDatePatch(
    { date: body.targetDate, resolution: body.targetDateResolution },
    fiscalMonth,
    'target',
    'targetDate',
    'targetDateResolution',
  );
  assertPlanningDateRange(start?.date ?? null, target?.date ?? null);
  return {
    ...(start === undefined
      ? {}
      : {
          startDate: start.date,
          startDateResolution: start.resolution,
          startDateFiscalYearStartMonth: start.fiscalYearStartMonth,
        }),
    ...(target === undefined
      ? {}
      : {
          targetDate: target.date,
          targetDateResolution: target.resolution,
          targetDateFiscalYearStartMonth: target.fiscalYearStartMonth,
        }),
  };
}

async function creationInitiatives(
  tx: TemplateTransaction,
  command: OrdinaryWorkCommand,
  ids: readonly string[] | undefined,
  context?: OrdinaryPreparationContext,
): Promise<string[]> {
  const unique = [...new Set(ids ?? [])];
  const existing = unique.filter(
    (id) => !prospectiveWorkReference(tx, command, context, 'initiative', id),
  );
  await validatedInitiativeIds(command.caller.orgId, existing, tx);
  return unique;
}
