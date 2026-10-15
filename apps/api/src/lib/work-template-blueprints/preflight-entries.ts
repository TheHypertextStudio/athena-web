import { BlueprintError } from '@docket/work/blueprints';
import { MilestoneCreate } from '@docket/work/milestone-contract';
import {
  createOrdinaryPreparationContext,
  inheritOrdinaryPreparationContext,
} from '../work-creation/ordinary-prospective';
import { prepareOrdinaryWork } from '../work-creation/ordinary-prepare';
import type {
  OrdinaryWorkCommand,
  OrdinaryPreparationContext,
  PreparedOrdinaryWork,
  ProspectiveWorkReference,
} from '../work-creation/types';
import type { TemplateTransaction } from '../templates/persistence';
import { prepareMilestoneRows } from '../milestone-writes';
import {
  blueprintNodeVisibility,
  commandForBlueprintNode,
  type AllocatedBlueprintNode,
} from './placement';
import type { PreparedBlueprintEntry } from './preflight';
import type { RetainedBlueprintEntry } from './retained';
import { requireWorkAccess } from '../work-template-selection';
import { validateBlueprintCreationTeams } from './context';
function prospective(
  row: AllocatedBlueprintNode,
  orgId: string,
  visibility: 'public' | 'private',
): ProspectiveWorkReference {
  const base = { id: row.id, orgId };
  switch (row.node.kind) {
    case 'initiative':
      return { ...base, kind: 'initiative' };
    case 'program':
      return { ...base, kind: 'program', visibility };
    case 'project':
      return { ...base, kind: 'project', visibility, programId: row.placement.programId ?? null };
    case 'task':
      return {
        ...base,
        kind: 'task',
        visibility,
        projectId: row.placement.projectId ?? null,
        programId: row.placement.programId ?? null,
        parentTaskId: row.placement.parentTaskId ?? null,
      };
    case 'milestone': {
      const projectId = row.placement.projectId;
      if (!projectId)
        throw new BlueprintError(
          'blueprint_invalid',
          'A checkpoint requires its selected Project.',
        );
      return { ...base, kind: 'milestone', projectId };
    }
  }
}
function originColumns(row: AllocatedBlueprintNode) {
  return {
    id: row.id,
    blueprintStepId: row.node.sourceStepId,
    blueprintSourceVersionId: row.node.sourceVersionId,
    blueprintParentKind: row.parent?.node.kind ?? null,
    blueprintParentId: row.parent?.id ?? null,
    blueprintPath: [...row.node.path],
    blueprintDateBindings: row.node.dateBindings,
  };
}
function checkpointEntry(
  command: OrdinaryWorkCommand,
  row: AllocatedBlueprintNode,
): PreparedBlueprintEntry {
  const fields = MilestoneCreate.parse({
    ...row.node.fields,
    targetDate: row.node.dates.targetDate ?? undefined,
    sort: row.node.step?.sort,
  });
  const projectId = row.placement.projectId;
  if (!projectId)
    throw new BlueprintError('blueprint_invalid', 'A checkpoint requires its selected Project.');
  return {
    kind: 'milestone',
    allocated: row,
    insert: {
      kind: 'milestone',
      values: {
        ...originColumns(row),
        organizationId: command.caller.orgId,
        createdBy: command.caller.actorId,
        projectId,
        name: fields.name,
        description: fields.description,
        targetDate: fields.targetDate ? new Date(fields.targetDate) : null,
        sort: fields.sort ?? 0,
      },
    },
  };
}

interface EntryPreparation {
  selected: OrdinaryWorkCommand;
  root: PreparedOrdinaryWork | null;
  allocated: readonly AllocatedBlueprintNode[];
  visibility: 'public' | 'private';
  preparationContext: OrdinaryPreparationContext | undefined;
  existing: ReadonlyMap<string, RetainedBlueprintEntry> | undefined;
}

/** Authorize every selected node and reserve its checkpoint rows before any insert. */
export async function prepareBlueprintEntries(
  tx: TemplateTransaction,
  input: EntryPreparation,
): Promise<PreparedBlueprintEntry[]> {
  const { selected, root, allocated, visibility } = input;
  await authorizeAdoptedParents(tx, input);
  const newRows = allocated.filter((row) => !input.existing?.has(JSON.stringify(row.node.path)));
  await validateBlueprintCreationTeams(
    tx,
    selected,
    newRows.flatMap((row) => (row.node.teamId ? [row.node.teamId] : [])),
  );
  const preparedContext = await createOrdinaryPreparationContext(
    tx,
    selected,
    newRows.map((row) =>
      prospective(row, selected.caller.orgId, blueprintNodeVisibility(row, visibility)),
    ),
    visibility,
    newRows
      .filter((row) => row.parent !== null && row.node.kind !== 'milestone')
      .map((row) => {
        if (!row.node.workTypeId || !row.node.workTypeVersionId || row.node.kind === 'milestone')
          throw new BlueprintError(
            'blueprint_invalid',
            'A generated child requires its resolved publication.',
          );
        return {
          prospectiveWorkId: row.id,
          kind: row.node.kind,
          workTypeId: row.node.workTypeId,
          workTypeVersionId: row.node.workTypeVersionId,
        };
      }),
  );
  if (input.preparationContext)
    inheritOrdinaryPreparationContext(tx, selected, preparedContext, input.preparationContext);
  const entries: PreparedBlueprintEntry[] = [];
  for (const row of allocated) {
    const existing = input.existing?.get(JSON.stringify(row.node.path));
    if (existing) {
      if (existing.work.kind !== row.node.kind)
        throw new BlueprintError(
          'blueprint_invalid',
          'An adopted row must retain its exact work kind.',
        );
      entries.push({ kind: 'existing', allocated: row, work: existing.work });
      continue;
    }
    if (row.node.kind === 'milestone') {
      entries.push(checkpointEntry(selected, row));
      continue;
    }
    const prepared =
      row.parent === null && root
        ? root
        : await prepareOrdinaryWork(
            tx,
            commandForBlueprintNode(selected, row, visibility),
            preparedContext,
          );
    Object.assign(prepared.insert.values, originColumns(row));
    const withCheckpoints =
      prepared.insert.kind === 'project'
        ? {
            ...prepared,
            milestoneRows: prepareMilestoneRows(
              { orgId: selected.caller.orgId, actorId: selected.caller.actorId, projectId: row.id },
              prepared.milestones,
              0,
            ),
          }
        : prepared;
    entries.push({ kind: 'ordinary', allocated: row, prepared: withCheckpoints });
  }
  return entries;
}

async function authorizeAdoptedParents(
  tx: TemplateTransaction,
  input: {
    selected: OrdinaryWorkCommand;
    allocated: readonly AllocatedBlueprintNode[];
    existing: ReadonlyMap<string, RetainedBlueprintEntry> | undefined;
  },
): Promise<void> {
  if (!input.selected.caller.actorId || !input.existing) return;
  const checked = new Set<string>();
  for (const row of input.allocated) {
    if (input.existing.has(JSON.stringify(row.node.path)) || !row.parent) continue;
    const parent = input.existing.get(JSON.stringify(row.parent.node.path));
    if (!parent) continue;
    const kind = parent.work.kind === 'milestone' ? 'project' : parent.work.kind;
    const id = parent.work.kind === 'milestone' ? parent.work.row.projectId : parent.work.id;
    const key = `${kind}:${id}`;
    if (checked.has(key)) continue;
    await requireWorkAccess(tx, input.selected.caller, kind, id);
    checked.add(key);
  }
}
