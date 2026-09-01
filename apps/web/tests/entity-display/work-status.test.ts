/**
 * The status display vocabulary shared by every roster.
 *
 * @remarks
 * Status presentation used to be derived from the *key*: a switch mapping `planned | active | …`
 * onto a glyph, and a record mapping the same keys onto labels. A workspace names its own statuses
 * now, so both answered wrong for anything renamed — an unrecognized key drew the neutral ring and
 * rendered no label at all.
 *
 * These cover the replacement: name and glyph come off the status itself, and ordering comes from
 * the position the workspace put it in rather than from a list written in the app.
 */
import type { TaskOut } from '@docket/work/task-model';
import type { WorkStatusCategory } from '@docket/work/work-status-contract';
import { describe, expect, it } from 'vitest';

import {
  type WorkStatusDisplay,
  statusFieldOptions,
  statusRankOf,
  unknownStatus,
} from '@/components/entity-display/work-status';
import { buildTaskCatalog } from '@/components/views/task-catalog';
import { sortRows } from '@/components/views/apply-view';

/** A workspace that renamed every stage and added a second in-progress one. */
const SET: readonly WorkStatusDisplay[] = [
  { key: 'icebox', name: 'Icebox', category: 'backlog' },
  { key: 'ready', name: 'Ready', category: 'unstarted' },
  { key: 'building', name: 'Building', category: 'started' },
  { key: 'in_review', name: 'In Review', category: 'started' },
  { key: 'shipped', name: 'Shipped', category: 'completed' },
];

describe('statusFieldOptions', () => {
  it('offers the workspace names as labels and the categories as glyph hints', () => {
    expect(statusFieldOptions(SET)).toEqual([
      { value: 'icebox', label: 'Icebox', hint: 'backlog' },
      { value: 'ready', label: 'Ready', hint: 'unstarted' },
      { value: 'building', label: 'Building', hint: 'started' },
      { value: 'in_review', label: 'In Review', hint: 'started' },
      { value: 'shipped', label: 'Shipped', hint: 'completed' },
    ]);
  });

  it('offers nothing for a set that has not arrived', () => {
    expect(statusFieldOptions([])).toEqual([]);
  });
});

describe('statusRankOf', () => {
  const rank = statusRankOf(SET);

  it('ranks a status by where the workspace put it, so two started stages stay distinct', () => {
    expect(rank('building')).toBeLessThan(rank('in_review'));
    expect(rank('icebox')).toBeLessThan(rank('building'));
  });

  it('sorts an unset value and an unrecognized key last', () => {
    expect(rank(null)).toBe(SET.length);
    expect(rank('deleted_stage')).toBe(SET.length);
  });
});

describe('unknownStatus', () => {
  it('shows the stored key plainly rather than hiding a status that left the set', () => {
    const status = unknownStatus('deleted_stage');
    expect(status.key).toBe('deleted_stage');
    expect(status.name).toBe('deleted_stage');
    expect(status.category).toBe<WorkStatusCategory>('backlog');
  });
});

describe('the task catalog status field', () => {
  const catalog = buildTaskCatalog({
    statuses: SET,
    projectLabel: 'Project',
    programLabel: 'Program',
    resolveProject: (id) => id,
    resolveProgram: (id) => id,
    resolveAssignee: (id) => id,
    assigneeOptions: () => [],
    projectOptions: () => [],
    programOptions: () => [],
  });

  it('offers exactly the statuses the workspace kept', () => {
    const field = catalog.find((candidate) => candidate.key === 'state');
    expect(field?.options?.map((option) => option.value)).toEqual(SET.map((status) => status.key));
  });

  it('sorts rows by the workspace board order, not alphabetically by key', () => {
    const rows = ['shipped', 'icebox', 'in_review', 'building'].map(
      (state) => ({ state }) as unknown as TaskOut,
    );
    const sorted = sortRows(rows, [{ field: 'state', dir: 'asc' }], catalog);
    expect(sorted.map((row) => row.state)).toEqual(['icebox', 'building', 'in_review', 'shipped']);
  });
});
