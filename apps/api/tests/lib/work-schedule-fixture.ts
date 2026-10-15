import { ActorId, OrganizationId, TeamId } from '@docket/identity-access/ids';
import { BlueprintStep } from '@docket/work/work-template-blueprint';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { BlueprintStepId, WorkTypeId, WorkTypeVersionId } from '@docket/work/ids';
import type {
  BlueprintCreationContext,
  PublishedBlueprintSnapshot,
  ResolvedBlueprintGraph,
  ResolvedBlueprintInput,
  WorkKind,
} from '@docket/work/blueprints';
export const ulid = (n: number): string => `01ARZ3NDEKTSV4RRFFQ${n.toString().padStart(7, '0')}`;
export const actor = ActorId.parse(ulid(10));
export const team = TeamId.parse(ulid(11));
export function step(
  key: string,
  kind = 'task',
  extra: Record<string, unknown> = {},
): BlueprintStep {
  return BlueprintStep.parse({
    key,
    kind,
    parentStepKey: null,
    sort: 0,
    optional: { enabled: false, selectedByDefault: true },
    template: null,
    fields: kind === 'task' ? { title: key } : { name: key },
    teamRule: 'parent_team',
    actorRule: 'unassigned',
    dates: {},
    ...(kind === 'task' ? { cycleRule: 'none' } : {}),
    ...extra,
  });
}
export function publication(
  n: number,
  kind: WorkKind,
  steps: BlueprintStep[] = [],
): PublishedBlueprintSnapshot {
  return {
    organizationId: OrganizationId.parse(ulid(1)),
    kind,
    workTypeId: WorkTypeId.parse(ulid(n)),
    versionId: WorkTypeVersionId.parse(ulid(n + 100)),
    definition: WorkTemplateDefinition.parse({
      name: `Template ${n}`,
      payload: { targetType: kind },
      blueprint: { steps, dependencies: [] },
    }),
    stepIds: Object.fromEntries(
      steps.map((entry, index) => [entry.key, BlueprintStepId.parse(ulid(n * 1000 + index))]),
    ),
  };
}
export function graph(
  root: PublishedBlueprintSnapshot,
  publications: PublishedBlueprintSnapshot[],
  resolutions: ResolvedBlueprintGraph['resolutions'],
): ResolvedBlueprintGraph {
  return { root, publications, resolutions, fingerprint: 'frozen' };
}
export function resolution(
  path: string[],
  snapshot: PublishedBlueprintSnapshot,
): ResolvedBlueprintGraph['resolutions'][number] {
  return { path, workTypeId: snapshot.workTypeId, versionId: snapshot.versionId };
}
export function context(extra: Partial<BlueprintCreationContext> = {}): BlueprintCreationContext {
  return {
    organizationId: OrganizationId.parse(ulid(1)),
    initiatingActorId: actor,
    actors: [{ id: actor, active: true }],
    athenaActorId: null,
    creationTeamId: team,
    creationDate: '2026-10-08',
    timezone: 'UTC',
    workingWeekdays: [1, 2, 3, 4, 5],
    cycles: [],
    completions: [],
    ...extra,
  };
}
export function input(extra: Partial<ResolvedBlueprintInput> = {}): ResolvedBlueprintInput {
  const base = publication(9, 'task');
  const root = publication(2, 'project', [
    step('child', 'task', {
      actorRule: 'parent_responsible',
      dates: {
        dueDate: {
          kind: 'anchor',
          anchor: { kind: 'parent' },
          offset: { days: -21, unit: 'calendar' },
        },
      },
    }),
  ]);
  return {
    graph: graph(root, [base], [resolution(['child'], base)]),
    root: {
      kind: 'project',
      fields: { name: 'Root' },
      teamId: team,
      responsibleActorId: actor,
      cycleId: null,
      dates: { targetDate: '2026-10-08' },
    },
    context: context(),
    choices: [],
    ...extra,
  };
}
