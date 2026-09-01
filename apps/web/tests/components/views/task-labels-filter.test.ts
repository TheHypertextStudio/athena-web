/**
 * `views` — filtering and grouping the task list by label.
 *
 * @remarks
 * Labels are the first field to use `FieldDescriptor.values`, the multi-value slot the engine
 * shipped with and nothing had exercised. The two behaviours that slot implies — a filter matches
 * if *any* value matches, and grouping fans one row into several buckets — are what these cover,
 * along with the deliberate choice to derive the field's options from the rows themselves.
 */
import type { TaskOut } from '@docket/work/task-model';
import { describe, expect, it } from 'vitest';

import { buildTaskCatalog } from '@/components/views/task-catalog';
import { applyView } from '@/components/views/apply-view';
import type { ViewState } from '@/components/views/field-catalog';

const DEPS = {
  statuses: [],
  projectLabel: 'Project',
  programLabel: 'Program',
  resolveProject: (id: string) => id,
  resolveProgram: (id: string) => id,
  resolveAssignee: (id: string) => id,
  assigneeOptions: () => [],
  projectOptions: () => [],
  programOptions: () => [],
};

/** A task carrying the given labels; everything else is filler. */
function task(id: string, labels: { id: string; name: string }[]): TaskOut {
  return {
    id,
    organizationId: 'org',
    title: id,
    teamId: 'team',
    state: 'todo',
    priority: 'none',
    labels,
    provenance: { source: 'native' },
    createdAt: '2026-01-01T00:00:00.000Z',
  } as unknown as TaskOut;
}

const BUG = { id: 'l-bug', name: 'bug' };
const DESIGN = { id: 'l-design', name: 'design' };

const TASKS = [task('t1', [BUG]), task('t2', [BUG, DESIGN]), task('t3', [DESIGN]), task('t4', [])];

/** A view state carrying only the given filter. */
function filterBy(value: string, op: 'eq' | 'neq' = 'eq'): ViewState {
  return { filters: [{ field: 'labels', op, value }], groupBy: null, sort: [] };
}

describe('task catalog — Label field', () => {
  it('is absent when the caller supplies no rows', () => {
    // A list where filtering by label would not earn its place simply has no Label field, rather
    // than one whose menu is empty or whose chips show raw ids.
    const catalog = buildTaskCatalog(DEPS);
    expect(catalog.find((f) => f.key === 'labels')).toBeUndefined();
  });

  it('offers only the labels that actually appear in the list', () => {
    // Offering a label nothing here carries would just empty the view.
    const catalog = buildTaskCatalog({ ...DEPS, tasks: [task('t1', [BUG])] });
    const field = catalog.find((f) => f.key === 'labels');
    expect(field?.resolveOptions?.()).toEqual([{ value: 'l-bug', label: 'bug' }]);
  });

  it('sorts its options by name, so the menu is stable between reads', () => {
    const catalog = buildTaskCatalog({ ...DEPS, tasks: TASKS });
    expect(catalog.find((f) => f.key === 'labels')?.resolveOptions?.()).toEqual([
      { value: 'l-bug', label: 'bug' },
      { value: 'l-design', label: 'design' },
    ]);
  });

  it('resolves a label id to its name for chips and group headers', () => {
    const catalog = buildTaskCatalog({ ...DEPS, tasks: TASKS });
    const field = catalog.find((f) => f.key === 'labels');
    expect(field?.resolveLabel?.('l-design')).toBe('design');
    // A label that has since vanished falls back to its id rather than rendering blank.
    expect(field?.resolveLabel?.('gone')).toBe('gone');
  });

  it('is not sortable — ordering a row by a set has no single honest answer', () => {
    const catalog = buildTaskCatalog({ ...DEPS, tasks: TASKS });
    expect(catalog.find((f) => f.key === 'labels')?.sortable).toBeFalsy();
  });

  it('matches a task if ANY of its labels matches', () => {
    const catalog = buildTaskCatalog({ ...DEPS, tasks: TASKS });
    const applied = applyView(TASKS, filterBy('l-bug'), catalog);
    // t2 carries `bug` alongside `design` and must still match.
    expect(applied.rows.map((r) => r.id)).toEqual(['t1', 't2']);
  });

  it('excludes every task carrying the label under `neq`', () => {
    const catalog = buildTaskCatalog({ ...DEPS, tasks: TASKS });
    const applied = applyView(TASKS, filterBy('l-bug', 'neq'), catalog);
    // t4 has no labels at all, which is "not bug" — an unlabelled row is not excluded.
    expect(applied.rows.map((r) => r.id)).toEqual(['t3', 't4']);
  });

  it('fans a multi-labelled task into one bucket per label when grouping', () => {
    const catalog = buildTaskCatalog({ ...DEPS, tasks: TASKS });
    const grouped = applyView(
      TASKS,
      { filters: [], groupBy: { field: 'labels' }, sort: [] },
      catalog,
    );
    const byLabel = new Map((grouped.groups ?? []).map((g) => [g.label, g.rows.map((r) => r.id)]));
    expect(byLabel.get('bug')).toEqual(['t1', 't2']);
    expect(byLabel.get('design')).toEqual(['t2', 't3']);
    // Group counts summing above the row count is correct here, not a bug.
    expect((grouped.groups ?? []).reduce((n, g) => n + g.rows.length, 0)).toBeGreaterThan(
      TASKS.length,
    );
  });
});
