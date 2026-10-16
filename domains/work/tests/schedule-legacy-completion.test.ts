import { expect, it } from 'vitest';
import { fixtureValue } from './schedule-field-timing-fixture';
import {
  legacyScheduleTasksComplete,
  normalizeLegacyScheduleCompletionFacts,
} from '../src/schedule-legacy-completion';
const source = { rootKey: 'one', path: ['same'] },
  other = { rootKey: 'two', path: ['same'] };
const mappings = [
  { reference: source, kind: 'task' as const, id: 'real-one' },
  { reference: other, kind: 'task' as const, id: 'real-two' },
  { reference: { rootKey: 'one', path: [] }, kind: 'project' as const, id: 'project' },
];
const policy = { kind: 'legacy_authored_tasks' as const, revision: 1 as const, tasks: [source] };
it('uses only mapped authored Task timestamps; Project state and template-only children do not block continuation', () => {
  expect(
    legacyScheduleTasksComplete(policy, mappings, [
      { kind: 'task', id: 'real-one', completedAt: '2026-10-15T07:00:00Z' },
    ]),
  ).toBe(true);
  expect(legacyScheduleTasksComplete({ ...policy, tasks: [] }, mappings, [])).toBe(true);
  expect(
    legacyScheduleTasksComplete(policy, mappings, [
      { kind: 'task', id: 'real-two', completedAt: '2026-10-15T07:00:00Z' },
      { kind: 'project', id: 'project', completedAt: '2026-10-15T07:00:00Z' },
    ]),
  ).toBe(false);
});
it('normalizes the actual timestamp criterion independent of lifecycle category and follows reopen/null/missing facts', () => {
  const original = {
    kind: 'task' as const,
    id: 'real-one',
    completedAt: '2026-10-15T07:00:00Z',
    state: 'canceled',
  };
  expect(normalizeLegacyScheduleCompletionFacts(mappings, [original])).toEqual([
    { kind: 'task', id: 'real-one', completedAt: original.completedAt, state: 'completed' },
  ]);
  expect(legacyScheduleTasksComplete(policy, mappings, [{ ...original, completedAt: null }])).toBe(
    false,
  );
  expect(
    normalizeLegacyScheduleCompletionFacts(mappings, [{ ...original, completedAt: null }]),
  ).toEqual([{ kind: 'task', id: 'real-one', completedAt: null, state: 'open' }]);
  expect(legacyScheduleTasksComplete(policy, mappings, [])).toBe(false);
});
it('refuses ambiguous duplicate actual mappings/facts and invalid timestamps without inventing an execution identity', () => {
  expect(() =>
    normalizeLegacyScheduleCompletionFacts([...mappings, fixtureValue(mappings[0])], []),
  ).toThrow();
  expect(() =>
    normalizeLegacyScheduleCompletionFacts(mappings, [
      { kind: 'task', id: 'real-one', completedAt: 'processing-now' },
    ]),
  ).toThrow();
  const fact = { kind: 'task' as const, id: 'real-one', completedAt: null };
  expect(() => normalizeLegacyScheduleCompletionFacts(mappings, [fact, fact])).toThrow();
});
