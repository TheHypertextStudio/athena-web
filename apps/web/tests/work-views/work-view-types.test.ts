import { describe, expect, it } from 'vitest';

import {
  InitiativeViewDefinition,
  TaskViewDefinition,
  ViewInstanceKey,
} from '@docket/work/work-view-contract';

import type {
  UseWorkViewOptions,
  WorkViewController,
} from '../../src/components/work-views/use-work-view';
import type { WorkViewToolbarProps } from '../../src/components/work-views/work-view-toolbar';
import type { WorkViewSortTerm } from '../../src/components/work-views/sort-builder';

const taskDefinition = TaskViewDefinition.parse({
  version: 2,
  target: 'task',
  filter: null,
  arrangement: { groupBy: null, subGroupBy: null, orderBy: [] },
  presentation: {
    layout: 'list',
    properties: ['status'],
    density: 'compact',
    showEmptyGroups: false,
  },
});

const initiativeDefinition = InitiativeViewDefinition.parse({
  version: 2,
  target: 'initiative',
  filter: null,
  arrangement: { groupBy: null, subGroupBy: null, orderBy: [] },
  presentation: {
    layout: 'timeline',
    properties: ['health'],
    density: 'compact',
    showEmptyGroups: false,
  },
});

describe('work-view component type relationships', () => {
  it('keeps target-specific definitions and sort keys related at compile time', () => {
    const taskProps: WorkViewToolbarProps<'task'> = {
      target: 'task',
      definition: taskDefinition,
      onDefinitionChange: () => undefined,
      onSaveView: () => undefined,
      onSetDefault: () => undefined,
      onReset: () => undefined,
    };
    const initiativeProps: WorkViewToolbarProps<'initiative'> = {
      target: 'initiative',
      definition: initiativeDefinition,
      onDefinitionChange: () => undefined,
      onSaveView: () => undefined,
      onSetDefault: () => undefined,
      onReset: () => undefined,
    };
    const taskSort: WorkViewSortTerm<'task'> = { field: 'dueDate', direction: 'asc' };
    const exerciseInitiativeController = (controller: WorkViewController<'initiative'>): void => {
      // @ts-expect-error assignee is not an Initiative filter field.
      controller.requestFacet('assignee', 'alex');
      // @ts-expect-error A Task definition cannot enter an Initiative controller setter.
      controller.setDefinition(taskDefinition);
    };

    const invalidInitiativeProps: WorkViewToolbarProps<'initiative'> = {
      target: 'initiative',
      // @ts-expect-error A Task definition cannot pair with the Initiative target.
      definition: taskDefinition,
      onDefinitionChange: () => undefined,
      onSaveView: () => undefined,
      onSetDefault: () => undefined,
      onReset: () => undefined,
    };
    const invalidInitiativeSort: WorkViewSortTerm<'initiative'> = {
      // @ts-expect-error dueDate is not an Initiative sort field.
      field: 'dueDate',
      direction: 'asc',
    };
    const invalidInitiativeContext: UseWorkViewOptions<'initiative'> = {
      organizationId: 'org-1',
      target: 'initiative',
      instanceKey: ViewInstanceKey.parse('builtin:initiative:01ARZ3NDEKTSV4RRFFQ69G5FAV'),
      fallback: initiativeDefinition,
      // @ts-expect-error Team contexts cannot constrain Initiative hierarchy queries.
      context: { kind: 'team', teamId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    };

    expect(taskProps.definition.target).toBe('task');
    expect(taskSort.field).toBe('dueDate');
    expect(initiativeProps.definition.target).toBe('initiative');
    expect(invalidInitiativeProps.target).toBe('initiative');
    expect(invalidInitiativeSort.field).toBe('dueDate');
    expect(invalidInitiativeContext.target).toBe('initiative');
    expect(exerciseInitiativeController).toBeTypeOf('function');
  });
});
