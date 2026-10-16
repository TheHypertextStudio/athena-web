import { describe, expect, it } from 'vitest';
import { normalizeLegacyBlueprint } from '../../src/work-template-blueprint-migration/normalize';
import {
  required,
  type RetainedGraph,
  type RetainedRow,
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
  it.each([
    ['unsupported kind', graph([step('a', 'a', 'initiative')], [])],
    ['missing spec', graph([step('a')], [])],
    ['duplicate spec', graph([step('a')], [spec('a'), spec('a')])],
    ['duplicate identity', graph([step('a'), step('a', 'other')], [spec('a')])],
    ['duplicate key', graph([step('a', 'same'), step('b', 'same')], [spec('a'), spec('b')])],
    [
      'normalized key collision',
      graph([step('a', '0old'), step('b', '0old')], [spec('a'), spec('b')]),
    ],
    ['root milestone', { ...graph([step('a', 'a', 'milestone')], []), milestones: [spec('a')] }],
    [
      'milestone owned by task',
      {
        ...graph([step('a'), step('b', 'b', 'milestone')], [spec('a')]),
        milestones: [{ step_id: 'b', project_step_id: 'a' }],
      },
    ],
  ])('refuses %s without altering retained input', (_name, input) => {
    const original = structuredClone(input);
    expect(() => normalizeLegacyBlueprint(input)).toThrow();
    expect(input).toEqual(original);
  });
  it('retains project/milestone/task ancestry and source keys', () => {
    const input = {
      ...graph(
        [
          step('project', 'project', 'project'),
          step('checkpoint', 'checkpoint', 'milestone'),
          step('task'),
        ],
        [{ ...spec('task'), milestone_step_id: 'checkpoint' }],
        [{ step_id: 'project' }],
      ),
      milestones: [{ step_id: 'checkpoint', project_step_id: 'project' }],
    };
    expect(normalizeLegacyBlueprint(input).map(({ rootId, path }) => ({ rootId, path }))).toEqual([
      { rootId: 'project', path: [] },
      { rootId: 'project', path: ['checkpoint'] },
      { rootId: 'project', path: ['checkpoint', 'task'] },
    ]);
  });
  it.each([
    ['foreign blocker', 'foreign', 'b'],
    ['foreign blocked step', 'a', 'foreign'],
    ['self prerequisite', 'a', 'a'],
  ])('refuses %s', (_name, blocking, blocked) => {
    const input = {
      ...graph([step('a'), step('b')], [spec('a'), spec('b')]),
      dependencies: [{ blocking_step_id: blocking, blocked_step_id: blocked }],
    };
    expect(() => normalizeLegacyBlueprint(input)).toThrow('outside its graph');
  });
  it('accepts the dependency bound and refuses an extra retained edge', () => {
    const input = {
      ...graph([step('a'), step('b')], [spec('a'), spec('b')]),
      dependencies: Array.from({ length: 2000 }, () => ({
        blocking_step_id: 'a',
        blocked_step_id: 'b',
      })),
    };
    expect(normalizeLegacyBlueprint(input)).toHaveLength(2);
    expect(() =>
      normalizeLegacyBlueprint({
        ...input,
        dependencies: [...input.dependencies, { blocking_step_id: 'a', blocked_step_id: 'b' }],
      }),
    ).toThrow('limit');
  });
});

describe('frozen retained field validation', () => {
  it.each([{}, { id: null }, { id: 7 }, { id: '' }])('refuses malformed text %j', (row) => {
    expect(() => required(row, 'id')).toThrow('Malformed retained blueprint field: id');
  });
  it('preserves original identifier text', () => {
    expect(required({ id: ' original ' }, 'id')).toBe(' original ');
  });
});

describe('frozen0151 publication format', () => {
  it.each([
    { kind: 'symbol', name: 'calendar_month' },
    { kind: 'emoji', hexcode: '1F469-200D-1F4BB' },
    null,
  ])('preserves valid historical glyphs %j', (icon) => {
    expect(
      parseHistoricalTemplateDefinition({
        name: ' Original ',
        description: '',
        defaultStatusKey: 'open',
        icon,
        payload: { targetType: 'task', title: '', description: 'Body' },
      }),
    ).toEqual({
      name: ' Original ',
      description: '',
      defaultStatusKey: 'open',
      icon,
      payload: { targetType: 'task', title: '', description: 'Body' },
    });
  });
  it.each([
    { targetType: 'task', priority: 'urgent', labelIds: ['01ARZ3NDEKTSV4RRFFQ69G5FAV'] },
    { targetType: 'task', priority: 'none', labelIds: [] },
    {
      targetType: 'project',
      name: 'Project',
      summary: 's'.repeat(280),
      description: '',
      status: 'active',
      health: 'at_risk',
    },
    { targetType: 'program', visibility: 'private', health: 'on_track' },
    { targetType: 'initiative', priority: 'high', updateCadence: 'quarterly', health: 'off_track' },
  ])('preserves original kind fields for $targetType', (payload) => {
    const input = { name: 'Historical definition', payload };
    const original = structuredClone(input);
    expect(parseHistoricalTemplateDefinition(input).payload).toEqual(payload);
    expect(input).toEqual(original);
  });
  it('copies historical label identities without retaining the mutable input array', () => {
    const labelIds = ['01ARZ3NDEKTSV4RRFFQ69G5FAV'];
    const parsed = parseHistoricalTemplateDefinition({
      name: 'Task',
      payload: { targetType: 'task', labelIds },
    });
    expect(parsed.payload['labelIds']).toEqual(labelIds);
    expect(parsed.payload['labelIds']).not.toBe(labelIds);
  });
  it.each([
    ['null definition', null],
    ['array definition', []],
    ['unknown definition field', { name: 'Task', extra: true }],
    ['missing name', {}],
    ['nontext name', { name: 7 }],
    ['blank name', { name: '  ' }],
    ['nontext description', { name: 'Task', description: 7 }],
    ['nontext default status', { name: 'Task', defaultStatusKey: false }],
    ['empty default status', { name: 'Task', defaultStatusKey: '' }],
    ['array glyph', { name: 'Task', icon: [] }],
    ['unknown glyph', { name: 'Task', icon: { kind: 'image' } }],
    ['nontext symbol', { name: 'Task', icon: { kind: 'symbol', name: 7 } }],
    ['malformed symbol', { name: 'Task', icon: { kind: 'symbol', name: 'Bad-Name' } }],
    ['nontext emoji', { name: 'Task', icon: { kind: 'emoji', hexcode: 7 } }],
    ['malformed emoji', { name: 'Task', icon: { kind: 'emoji', hexcode: '1f600' } }],
    ['missing payload', { name: 'Task' }],
    ['array payload', { name: 'Task', payload: [] }],
    ['unknown kind', { name: 'Task', payload: { targetType: 'milestone' } }],
    ['nontext field', { name: 'Task', payload: { targetType: 'task', title: 7 } }],
    ['nontext option', { name: 'Task', payload: { targetType: 'task', priority: null } }],
    ['unknown option', { name: 'Task', payload: { targetType: 'task', priority: 'critical' } }],
    ['nonarray labels', { name: 'Task', payload: { targetType: 'task', labelIds: 'label' } }],
    ['nontext label', { name: 'Task', payload: { targetType: 'task', labelIds: [7] } }],
    [
      'noncanonical label',
      { name: 'Task', payload: { targetType: 'task', labelIds: ['invalid'] } },
    ],
    [
      'long summary',
      { name: 'Project', payload: { targetType: 'project', summary: 's'.repeat(281) } },
    ],
    ['empty status', { name: 'Project', payload: { targetType: 'project', status: '' } }],
    ['invalid health', { name: 'Project', payload: { targetType: 'project', health: 'blocked' } }],
    [
      'invalid visibility',
      { name: 'Program', payload: { targetType: 'program', visibility: 'internal' } },
    ],
    [
      'invalid cadence',
      { name: 'Initiative', payload: { targetType: 'initiative', updateCadence: 'daily' } },
    ],
    [
      'invalid initiative priority',
      { name: 'Initiative', payload: { targetType: 'initiative', priority: 'urgent' } },
    ],
  ])('refuses %s', (_name, input) => {
    expect(() => parseHistoricalTemplateDefinition(input)).toThrow();
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
