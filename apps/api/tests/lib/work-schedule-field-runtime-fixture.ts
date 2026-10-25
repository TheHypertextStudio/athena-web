import type { ExistingBlueprintNode } from '@docket/work/blueprints';
import {
  compileScheduleCommand,
  parseScheduleDocument,
  planScheduleBlueprint,
} from '../../src/lib/recurrence/schedule-compiler';
import { compileScheduleTiming } from '../../src/lib/recurrence/schedule-timing';
import { actor, input, team, ulid } from './work-schedule-fixture';

/** Raw single-root v2 field-timing forest; `extra` replaces top-level document properties. */
export function document(extra: Record<string, unknown> = {}): unknown {
  return {
    kind: 'forest',
    revision: 2,
    state: 'published',
    creationMode: 'when_ready',
    roots: [
      {
        key: 'root',
        draft: {
          kind: 'schedule',
          revision: 1,
          template: { targetType: 'project', workTypeId: ulid(2), selection: { kind: 'latest' } },
          titlePattern: 'Dinner',
          timezone: 'America/Los_Angeles',
          root: { kind: 'project', fields: {}, placement: {}, dates: {}, teamId: team },
          stepOverrides: [{ kind: 'task', path: ['child'], fields: { description: '' } }],
          optionalChoices: [],
        },
      },
    ],
    dependencies: [],
    timing: {
      kind: 'field_timing',
      revision: 2,
      rules: [
        {
          target: { rootKey: 'root', path: [], field: 'startDate' },
          source: { kind: 'after_completion', works: [{ rootKey: 'root', path: ['child'] }] },
          offset: { days: 2, unit: 'calendar' },
        },
      ],
    },
    absentFields: [{ rootKey: 'root', path: [], field: 'targetDate' }],
    titlePolicy: { kind: 'legacy_title', revision: 1 },
    titles: [
      {
        target: { rootKey: 'root', path: [] },
        kind: 'project',
        pattern: '{month} {monthName} {unknown}',
      },
      {
        target: { rootKey: 'root', path: ['child'] },
        kind: 'task',
        pattern: 'Child {month} {year} {unknown}',
      },
    ],
    completionPolicy: {
      kind: 'legacy_authored_tasks',
      revision: 1,
      tasks: [{ rootKey: 'root', path: ['child'] }],
    },
    ...extra,
  };
}

/** Compile the forest and pair each root with the ordinary planner on the resolved input. */
export function planned(extra: Record<string, unknown> = {}, resolved = input()) {
  const command = compileScheduleCommand({
    caller: { orgId: ulid(1), actorId: actor, roleId: null, capabilities: ['manage'] },
    seriesId: ulid(3),
    ownerProgramId: null,
    runDate: '2026-10-08',
    document: parseScheduleDocument(document(extra)),
  });
  const plans = command.roots.map(({ command: root }) => ({
    tree: planScheduleBlueprint(root, resolved).tree,
    workingWeekdays: resolved.context.workingWeekdays,
    replan: (next: typeof root) => planScheduleBlueprint(next, resolved).tree,
  }));
  return { command, plans };
}

/** Accepted physical work for the compiled forest: root `ulid(20)` and children from `ulid(21)`. */
export function actual(extra: Record<string, unknown> = {}) {
  const { command, plans } = planned(extra);
  const compiled = compileScheduleTiming(command, plans);
  const root = compiled.roots[0];
  if (!root) throw new Error('Missing root');
  const tree = plans[0]?.replan(root.command);
  if (!tree) throw new Error('Missing tree');
  const nodes = tree.nodes.map((node, index): ExistingBlueprintNode => ({
    ...node,
    id: ulid(20 + index),
    parentId: index ? ulid(20) : null,
    state: 'unstarted',
    everStarted: false,
    cancellable: node.kind === 'task',
  }));
  const roots = [
    {
      key: 'root',
      kind: 'project' as const,
      id: ulid(20),
      resolvedManifest: tree.manifest,
      selectedWork: nodes.map((node) => ({
        path: [...node.path],
        kind: node.kind as 'project' | 'task',
        id: node.id,
      })),
    },
  ];
  return { document: parseScheduleDocument(document(extra)), nodes, roots };
}
