import { describe, expect, it } from 'vitest';
import { normalizeLegacyBlueprint } from '../../src/work-template-blueprint-migration/normalize';
import type {
  RetainedGraph,
  RetainedRow,
} from '../../src/work-template-blueprint-migration/contracts';
import { parseHistoricalTemplateDefinition } from '../../src/work-template-migration/definition';

function graph(
  steps: RetainedRow[],
  tasks: RetainedRow[],
  projects: RetainedRow[] = [],
): RetainedGraph {
  return {
    definition: {},
    revision: {},
    steps,
    tasks,
    projects,
    milestones: [],
    dependencies: [],
    taskLabels: [],
    projectLabels: [],
  };
}
const step = (id: string, key = id, kind = 'task'): RetainedRow => ({
  id,
  key,
  kind,
  sort: 0,
  timing_kind: 'on_trigger',
  offset_days: null,
  after_step_id: null,
});
const spec = (id: string, parent: string | null = null): RetainedRow => ({
  step_id: id,
  parent_task_step_id: parent,
  project_step_id: null,
  milestone_step_id: null,
});

describe('frozen retained blueprint normalization', () => {
  it('retains independent forest roots without fabricating a container', () => {
    const result = normalizeLegacyBlueprint(
      graph(
        [step('project', 'project', 'project'), step('task')],
        [spec('task')],
        [{ step_id: 'project' }],
      ),
    );
    expect(result.map((row) => ({ id: row.id, rootId: row.rootId, path: row.path }))).toEqual([
      { id: 'project', rootId: 'project', path: [] },
      { id: 'task', rootId: 'task', path: [] },
    ]);
  });
  it('normalizes old digit-leading and long keys deterministically with a reversible source key', () => {
    const input = graph([step('a', '0old'), step('b', 'x'.repeat(80))], [spec('a'), spec('b')]);
    const result = normalizeLegacyBlueprint(input);
    expect(result.map((row) => row.key)).toEqual(
      normalizeLegacyBlueprint(input).map((row) => row.key),
    );
    expect(result.every((row) => /^[a-z][a-z0-9_-]{0,63}$/.test(row.key))).toBe(true);
    expect(result[0]?.row['key']).toBe('0old');
  });
  it('retains qualified hierarchy paths', () => {
    const input = graph(
      [step('root'), step('a'), step('b')],
      [spec('root'), spec('a', 'root'), spec('b', 'a')],
    );
    expect(normalizeLegacyBlueprint(input).at(-1)?.path).toEqual(['a', 'b']);
  });
  it('rejects hierarchy cycles', () => {
    expect(() =>
      normalizeLegacyBlueprint(graph([step('a'), step('b')], [spec('a', 'b'), spec('b', 'a')])),
    ).toThrow('cycle');
  });
  it('rejects foreign revision parents', () => {
    expect(() => normalizeLegacyBlueprint(graph([step('a')], [spec('a', 'foreign')]))).toThrow();
  });
  it('rejects mixed dependency and completion cycles', () => {
    const input = graph(
      [
        step('a'),
        { ...step('b'), timing_kind: 'after_step_completion', after_step_id: 'a', offset_days: 0 },
      ],
      [spec('a'), spec('b')],
    );
    expect(() =>
      normalizeLegacyBlueprint({
        ...input,
        dependencies: [{ blocking_step_id: 'b', blocked_step_id: 'a' }],
      }),
    ).toThrow('cycle');
  });
  it('rejects501 nodes across independent roots', () => {
    const rows = Array.from({ length: 501 }, (_, index) => step(`step_${index}`));
    expect(() =>
      normalizeLegacyBlueprint(
        graph(
          rows,
          rows.map((row) => spec(String(row['id']))),
        ),
      ),
    ).toThrow('limit');
  });
  it('accepts500 nodes across independent roots', () => {
    const rows = Array.from({ length: 500 }, (_, index) => step(`step_${index}`));
    expect(
      normalizeLegacyBlueprint(
        graph(
          rows,
          rows.map((row) => spec(String(row['id']))),
        ),
      ),
    ).toHaveLength(500);
  });
});

it('freezes0151 JSON without serializing later blueprint or Task defaults', () => {
  expect(
    parseHistoricalTemplateDefinition({
      name: 'Blank task',
      payload: { targetType: 'task', state: 'in_progress', estimate: 8 },
    }),
  ).toEqual({
    name: 'Blank task',
    description: null,
    icon: null,
    defaultStatusKey: null,
    payload: { targetType: 'task' },
  });
});
