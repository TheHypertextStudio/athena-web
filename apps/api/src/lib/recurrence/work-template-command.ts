import { genId, type BlueprintInvocationRoot } from '@docket/db';
import { orderRetainedRoots } from './work-template-root-order';
import { TaskCreate } from '@docket/work/task-model';
import { WorkTypeId, WorkTypeVersionId } from '@docket/work/ids';
import { ConflictError } from '../../error';
import { ProjectCreate } from '../../contracts/project';
import type { TemplateTransaction } from '../templates/persistence';
import { originFor, ruleProvenance } from '../provenance/context';
import {
  requireRetainedOccurrenceAuthority,
  type RetainedOccurrenceAuthority,
} from '../work-creation/retained-authority';
import type { OrdinaryWorkCommand, WorkCreationBatchCommand } from '../work-creation/types';
import { loadRetainedPresets } from '../work-template-blueprints/retained';
import { retainedBlueprintSources } from '../work-template-blueprints/retained-paths';
import type { RetainedBlueprintPreset } from '../work-template-blueprints/retained-overrides';

function rootCommand(
  caller: OrdinaryWorkCommand['caller'],
  root: BlueprintInvocationRoot,
  preset: RetainedBlueprintPreset,
  invocation: OrdinaryWorkCommand['invocation'],
): OrdinaryWorkCommand {
  if (!root.workTypeId || !root.workTypeVersionId)
    throw new ConflictError('Publish the process before running it.');
  const raw = {
    ...preset.fields,
    ...preset.override.dates,
    ...preset.placement,
    workTypeId: WorkTypeId.parse(root.workTypeId),
    workTypeVersionId: WorkTypeVersionId.parse(root.workTypeVersionId),
  };
  const values = Object.fromEntries(
    Object.entries(raw).filter(
      ([key, value]) => value !== null || key === 'health' || key === 'estimateMinutes',
    ),
  );
  if (root.kind === 'task') {
    const command = {
      kind: 'task' as const,
      invocation,
      body: TaskCreate.parse({
        ...values,
        teamId: preset.override.teamId ?? undefined,
        assigneeId: preset.override.responsibleActorId ?? undefined,
        cycleId: preset.override.cycleId ?? undefined,
        labels: preset.labelIds,
      }),
    };
    return 'kind' in caller ? { ...command, caller } : { ...command, caller };
  }
  const command = {
    kind: 'project' as const,
    invocation,
    body: ProjectCreate.parse({
      ...values,
      teamId: preset.override.teamId ?? undefined,
      leadId: preset.override.responsibleActorId ?? undefined,
      labelIds: preset.labelIds,
    }),
  };
  return 'kind' in caller ? { ...command, caller } : { ...command, caller };
}
/** Construct the existing shared creation forest only from an exact checked persisted private occurrence. */
export async function retainedOccurrenceCommand(
  tx: TemplateTransaction,
  authority: RetainedOccurrenceAuthority,
): Promise<WorkCreationBatchCommand> {
  const facts = requireRetainedOccurrenceAuthority(tx, authority);
  const origin = originFor(
    'recurrence_materialize',
    {},
    ruleProvenance('recurrence', { seriesId: facts.seriesId }),
  );
  const roots: WorkCreationBatchCommand['roots'][number][] = [];
  for (const root of orderRetainedRoots(
    facts.manifest.roots,
    facts.manifest.steps,
    facts.overrides,
  )) {
    const binding = { authority, rootKey: root.key };
    const presets = await loadRetainedPresets(tx, binding);
    const preset = presets.find((value) => value.sourceStepId === root.sourceStepId);
    if (!preset) throw new ConflictError('Retained root mapping changed');
    roots.push({
      key: root.key,
      command: rootCommand(facts.caller, root, preset, {
        origin,
        prospectiveWorkId: facts.mappedWork.get(root.sourceStepId)?.id ?? genId(),
        retainedBinding: binding,
        labelIds: preset.labelIds,
        placement: { programId: preset.placement.programId ?? null },
      }),
    });
  }
  const sources = new Map(
    (await retainedBlueprintSources(tx, authority)).map((step) => [step.sourceStepId, step]),
  );
  const edges = facts.manifest.dependencies.map((edge) => {
    const blocker = sources.get(edge.blockerStepId);
    const blocked = sources.get(edge.blockedStepId);
    if (!blocker || !blocked) throw new ConflictError('Retained dependency mapping changed');
    return {
      blocker: { rootKey: blocker.rootKey, path: blocker.path },
      blocked: { rootKey: blocked.rootKey, path: blocked.path },
    };
  });
  return { roots, edges, invocation: { origin } };
}
