import { expect, it } from 'vitest';
import {
  privateScheduleRootFromPreset,
  privateScheduleStepFromPreset,
} from '../src/schedule-private-presets';
const team = '01K00000000000000000000001',
  actor = '01K00000000000000000000002',
  project = '01K00000000000000000000003';
it('preserves literal private fields, explicit unassigned values and real destinations without exposing structure or offsets', () => {
  const source = {
    kind: 'task' as const,
    fields: {
      title: 'Task {date}',
      description: '',
      summary: null,
      team_id: team,
      assignee_id: null,
      project_id: project,
      start_offset_days: -2,
      private_unknown: 'ignored',
      estimate_minutes: 30,
      labelIds: [],
    },
  };
  expect(privateScheduleRootFromPreset(source)).toEqual({
    kind: 'task',
    fields: {
      title: 'Task {date}',
      description: '',
      summary: null,
      estimateMinutes: 30,
      labelIds: [],
    },
    dates: {},
    placement: { projectId: project },
    teamId: team,
    responsibleActorId: null,
  });
  expect(
    privateScheduleStepFromPreset({ ...source, fields: { ...source.fields, assignee_id: actor } }, [
      'nested',
      'task',
    ]),
  ).toEqual({
    kind: 'task',
    path: ['nested', 'task'],
    fields: {
      title: 'Task {date}',
      description: '',
      summary: null,
      estimateMinutes: 30,
      labelIds: [],
    },
    dates: {},
    teamId: team,
    responsibleActorId: actor,
  });
});
it('retains Project nulls and Milestone body without treating labels or Task fields as universal fields', () => {
  expect(
    privateScheduleRootFromPreset({
      kind: 'project',
      fields: { name: 'Project', description: null, health: null, lead_id: null, labelIds: [] },
    }),
  ).toEqual({
    kind: 'project',
    fields: { name: 'Project', description: '', health: null, labelIds: [] },
    dates: {},
    placement: {},
    responsibleActorId: null,
  });
  expect(
    privateScheduleStepFromPreset(
      {
        kind: 'milestone',
        fields: { name: 'Checkpoint', description: '', labelIds: [], team_id: team },
      },
      ['checkpoint'],
    ),
  ).toEqual({
    kind: 'milestone',
    path: ['checkpoint'],
    fields: { name: 'Checkpoint', description: '' },
    dates: {},
  });
});
it('rejects foreign shape and invalid references rather than inventing a fallback work identity', () => {
  expect(() =>
    privateScheduleRootFromPreset({ kind: 'task', fields: { title: 'Task', team_id: 'invalid' } }),
  ).toThrow();
  expect(() =>
    privateScheduleRootFromPreset({ kind: 'milestone', fields: { name: 'Checkpoint' } }),
  ).toThrow();
});
