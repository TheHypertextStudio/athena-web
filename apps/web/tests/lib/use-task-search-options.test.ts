/**
 * Turning task search hits into relation-picker rows.
 *
 * @remarks
 * A relation picker must never offer the subject task or a task already linked, must never offer a
 * non-task the search happened to return, and must know enough about a chosen row to show it on
 * the page before the server confirms the link.
 */
import { describe, expect, it } from 'vitest';

import type { SearchResult } from '../../src/lib/contracts/search';
import { taskRefOf, taskSearchOptions } from '../../src/lib/use-task-search-options';

const TASK_A = '01BX5ZZKBKACTAV9WEVGEMMVA1';
const TASK_B = '01BX5ZZKBKACTAV9WEVGEMMVA2';
const PROJECT = '01BX5ZZKBKACTAV9WEVGEMMVJ1';

function hit(entityId: string, overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    kind: 'task',
    entityId,
    title: `Task ${entityId.slice(-2)}`,
    facets: { state: 'in_progress', projectId: PROJECT },
    ...overrides,
  } as SearchResult;
}

describe('taskSearchOptions', () => {
  it('keeps search rank, drops excluded ids, and drops anything that is not a task', () => {
    const options = taskSearchOptions(
      [hit(TASK_B), hit(TASK_A), hit('01BX5ZZKBKACTAV9WEVGEMMVA3', { kind: 'project' })],
      { exclude: new Set([TASK_A]) },
    );

    expect(options.map((option) => option.value)).toEqual([TASK_B]);
    expect(options[0]?.label).toBe('Task A2');
  });

  it('decorates a row with its state glyph and its project, when the caller asks', () => {
    const [option] = taskSearchOptions([hit(TASK_A)], {
      exclude: new Set(),
      iconFor: (state) => `icon:${state ?? ''}`,
      projectName: () => 'Launch',
    });

    expect(option?.icon).toBe('icon:in_progress');
    expect(option?.hint).toBe('Launch');
  });

  it('leaves the hint off when the caller names no project for it', () => {
    const [option] = taskSearchOptions([hit(TASK_A)], {
      exclude: new Set(),
      projectName: () => null,
    });

    expect(option?.hint).toBeUndefined();
  });
});

describe('taskRefOf', () => {
  it('carries the title, state, and project the hit knows', () => {
    expect(taskRefOf(hit(TASK_A))).toEqual({
      id: TASK_A,
      title: 'Task A1',
      state: 'in_progress',
      projectId: PROJECT,
    });
  });

  it('reads a project-less hit as having no project', () => {
    expect(taskRefOf(hit(TASK_A, { facets: { state: 'todo' } })).projectId).toBeNull();
  });
});
