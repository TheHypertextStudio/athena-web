import type {
  BlueprintNodeOverride,
  BlueprintCreationContext,
  BlueprintPlacement,
  ExistingBlueprintNode,
  ResolvedRootDraft,
} from '@docket/work/blueprints';
import { completionCivilDate } from '@docket/work/blueprints';
import { compileRetainedPreset, type RetainedBlueprintPreset } from './retained-overrides';
import { ConflictError } from '../../error';
import type { TemplateTransaction } from '../templates/persistence';
import {
  requireRetainedOccurrenceAuthority,
  type RetainedRootBinding,
  type RetainedOccurrenceWork,
} from '../work-creation/retained-authority';
import type { InsertedWork } from '../work-creation/writers';
import { loadBlueprintSnapshot } from './snapshot';
import { retainedBlueprintSources } from './retained-paths';
import type { AuthorizedBlueprintSnapshot } from './snapshot-types';
import {
  loadRetainedBlueprintLineage,
  loadRetainedSnapshotLineage,
  retainedManagedParentPath,
  type RetainedBlueprintLineage,
} from './retained-lineage';

/** One exact authorized existing row whose current values remain untouched during add-missing creation. */
export interface RetainedBlueprintEntry {
  readonly work: InsertedWork;
  readonly snapshot: ExistingBlueprintNode;
  readonly actualPlacement: BlueprintPlacement;
  readonly visibility: 'public' | 'private';
}
/** Existing original source mappings and managed descendants at their immutable generation paths. */
export interface RetainedBlueprintRoot {
  readonly root: ResolvedRootDraft | null;
  readonly context: BlueprintCreationContext | null;
  readonly presets: readonly RetainedBlueprintPreset[];
  readonly existingByPath: ReadonlyMap<string, RetainedBlueprintEntry>;
  readonly overrides: readonly BlueprintNodeOverride[];
  readonly idsByPath: ReadonlyMap<string, string>;
  readonly visibility: 'public' | 'private';
}
function placementOf(work: InsertedWork): BlueprintPlacement {
  switch (work.kind) {
    case 'task':
      return {
        programId: work.row.programId,
        projectId: work.row.projectId,
        milestoneId: work.row.milestoneId,
        parentTaskId: work.row.parentTaskId,
      };
    case 'project':
      return { programId: work.row.programId };
    case 'milestone':
      return { projectId: work.row.projectId };
    case 'initiative':
    case 'program':
      return {};
  }
}
function entryFor(
  work: InsertedWork,
  snapshot: ExistingBlueprintNode,
  rootVisibility: 'public' | 'private',
): RetainedBlueprintEntry {
  return {
    work,
    snapshot,
    actualPlacement: placementOf(work),
    visibility: 'visibility' in work.row ? work.row.visibility : rootVisibility,
  };
}
function actualOverride(entry: RetainedBlueprintEntry): BlueprintNodeOverride {
  const node = entry.snapshot;
  return {
    path: node.path,
    fields: node.fields,
    dates: node.dates,
    teamId: node.teamId,
    responsibleActorId: node.responsibleActorId,
    cycleId: node.cycleId,
    documentPrepared: true,
  };
}
function rootDraft(entry: RetainedBlueprintEntry): ResolvedRootDraft {
  const node = entry.snapshot;
  const context = {
    teamId: node.teamId,
    responsibleActorId: node.responsibleActorId,
    cycleId: node.cycleId,
    dates: node.dates,
    placement: entry.actualPlacement,
    terminal: node.state === 'completed' || node.state === 'canceled',
    documentPrepared: true,
  };
  switch (entry.work.kind) {
    case 'task':
      return {
        ...context,
        kind: 'task',
        fields: node.fields,
      };
    case 'project':
      return {
        ...context,
        kind: 'project',
        fields: node.fields,
      };
    default:
      throw new ConflictError('Retained root mapping changed');
  }
}
function managedPath(
  work: InsertedWork,
  existing: ReadonlyMap<string, RetainedBlueprintEntry>,
  lineage: RetainedBlueprintLineage,
  tx: TemplateTransaction,
): readonly string[] | null {
  const row = work.row;
  const parentPath = retainedManagedParentPath(tx, lineage, { ...row, kind: work.kind });
  if (!parentPath || !row.blueprintParentId) return null;
  const knownParent = [...existing.values()].some(
    (entry) =>
      entry.work.kind === row.blueprintParentKind &&
      entry.work.id === row.blueprintParentId &&
      JSON.stringify(entry.snapshot.path) === JSON.stringify(parentPath),
  );
  return knownParent ? row.blueprintPath : null;
}
function collectSnapshot(
  loaded: AuthorizedBlueprintSnapshot,
  state: {
    mapped: readonly RetainedOccurrenceWork[];
    existing: Map<string, RetainedBlueprintEntry>;
    visibility: 'public' | 'private';
    lineage: RetainedBlueprintLineage;
    tx: TemplateTransaction;
  },
): 'public' | 'private' {
  let visibility = state.visibility;
  for (const node of loaded.nodes) {
    const work = loaded.rowsByRef.get(`${node.kind}:${node.id}`);
    if (!work) throw new ConflictError('Retained work mapping changed');
    const mapped = state.mapped.find((row) => row.kind === node.kind && row.id === node.id);
    const path = mapped?.path ?? managedPath(work, state.existing, state.lineage, state.tx);
    if (!path) continue;
    const parentPath = path.length ? path.slice(0, -1) : null;
    const entry = entryFor(work, { ...node, path, parentPath }, visibility);
    const key = JSON.stringify(path);
    const prior = state.existing.get(key);
    if (prior && prior.work.id !== entry.work.id)
      throw new ConflictError('Retained work mapping changed');
    state.existing.set(key, entry);
    if (path.length === 0) visibility = entry.visibility;
  }
  return visibility;
}
/** Load actual mapped work through the shared authorized snapshot; this helper never writes or revalidates rows as new work. */
export async function loadRetainedBlueprintRoot(
  tx: TemplateTransaction,
  binding: RetainedRootBinding,
): Promise<RetainedBlueprintRoot> {
  const facts = requireRetainedOccurrenceAuthority(tx, binding.authority);
  const selected = facts.manifest.roots.find((root) => root.key === binding.rootKey);
  if (!selected) throw new ConflictError('Retained root mapping changed');
  const sources = await retainedBlueprintSources(tx, binding.authority);
  const mapped = [...facts.mappedWork.values()]
    .filter((row) => row.rootKey === binding.rootKey)
    .map((row) => ({
      ...row,
      path: sources.find((source) => source.sourceStepId === row.sourceStepId)?.path ?? row.path,
    }));
  const existing = new Map<string, RetainedBlueprintEntry>();
  const lineage = await loadRetainedBlueprintLineage(tx, binding);
  const rootMap = mapped.find((row) => row.sourceStepId === selected.sourceStepId);
  const ordered = rootMap ? [rootMap, ...mapped.filter((row) => row !== rootMap)] : mapped;
  let context: BlueprintCreationContext | null = null;
  let visibility: 'public' | 'private' = 'public';
  for (const mapping of ordered) {
    if (
      [...existing.values()].some(
        (entry) => entry.work.kind === mapping.kind && entry.work.id === mapping.id,
      )
    )
      continue;
    const loaded = await loadBlueprintSnapshot(
      tx,
      binding.authority,
      { kind: mapping.kind, id: mapping.id },
      { scope: 'retained' },
    );
    if (mapping.sourceStepId === selected.sourceStepId) context = loaded.context;
    await loadRetainedSnapshotLineage(tx, lineage, loaded);
    visibility = collectSnapshot(loaded, { mapped, existing, visibility, lineage, tx });
  }
  const root = existing.get('[]');
  const presets = await loadRetainedPresets(tx, binding);
  const overrides = new Map(
    presets.map((preset) => [JSON.stringify(preset.override.path), preset.override]),
  );
  for (const entry of existing.values())
    overrides.set(JSON.stringify(entry.snapshot.path), actualOverride(entry));
  return {
    root: root ? rootDraft(root) : null,
    context: context
      ? {
          ...context,
          completions: context.completions.map((fact) => ({
            ...fact,
            path:
              [...existing.values()].find((entry) => entry.work.id === fact.id)?.snapshot.path ??
              fact.path,
          })),
        }
      : null,
    presets,
    existingByPath: existing,
    overrides: [...overrides.values()],
    idsByPath: new Map([...existing].map(([path, entry]) => [path, entry.work.id])),
    visibility,
  };
}

/** Compile private presets with only completion facts authorized by this exact occurrence proof. */
export async function loadRetainedPresets(
  tx: TemplateTransaction,
  binding: RetainedRootBinding,
): Promise<readonly RetainedBlueprintPreset[]> {
  const facts = requireRetainedOccurrenceAuthority(tx, binding.authority);
  const completionDates = new Map<string, string>();
  const prerequisites = new Set(
    facts.overrides.flatMap((entry) =>
      entry.timing.afterStepId ? [entry.timing.afterStepId] : [],
    ),
  );
  for (const sourceId of prerequisites) {
    const mapping = facts.mappedWork.get(sourceId);
    if (!mapping) continue;
    const snapshot = await loadBlueprintSnapshot(
      tx,
      binding.authority,
      { kind: mapping.kind, id: mapping.id },
      { scope: 'retained' },
    );
    const row = snapshot.rowsByRef.get(`${mapping.kind}:${mapping.id}`);
    if (row?.kind === 'task' && row.row.completedAt)
      completionDates.set(
        sourceId,
        completionCivilDate(
          row.row.completedAt.toISOString(),
          facts.scheduleTimezone ?? snapshot.context.timezone,
        ),
      );
  }
  const sources = await retainedBlueprintSources(tx, binding.authority);
  return sources
    .filter((source) => source.rootKey === binding.rootKey)
    .map((source) => {
      const entry = facts.overrides.find((value) => value.sourceStepId === source.sourceStepId);
      if (!entry) throw new ConflictError('Recurrence binding changed');
      return compileRetainedPreset(source, entry, facts.runDate, completionDates);
    });
}
