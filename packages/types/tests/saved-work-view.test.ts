import { describe, expect, it } from 'vitest';

import { HubPreferences } from '../src/hub-preferences';
import { ProjectViewDefinition } from '../src/work-view';
import {
  migrateLegacyTaskViewDefinition,
  OrganizationWorkViewDefault,
  parseSavedWorkViewUpdate,
  projectTaskViewDefinitionToLegacy,
  projectTaskViewDefinitionToLegacyFallback,
  SavedWorkViewCreate,
  SavedWorkViewOut,
} from '../src/saved-view';

const ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

describe('saved work views', () => {
  it('projects a compatible v2 Task definition back to the legacy response fields', () => {
    const definition = migrateLegacyTaskViewDefinition({
      filters: [
        { field: 'priority', op: 'eq', value: 'high' },
        { field: 'assigneeId', op: 'in', value: [ID] },
      ],
      grouping: { by: 'state', subBy: 'assigneeId' },
      sort: [{ field: 'dueDate', order: 'desc' }],
    });

    expect(projectTaskViewDefinitionToLegacy(definition)).toEqual({
      filters: [
        { field: 'priority', op: 'eq', value: 'high' },
        { field: 'assigneeId', op: 'in', value: [ID] },
      ],
      grouping: { by: 'state', subBy: 'assigneeId' },
      sort: [{ field: 'dueDate', order: 'desc' }],
    });
  });

  it('uses a fail-closed legacy filter when a valid v2 Task definition cannot be projected', () => {
    const definition = migrateLegacyTaskViewDefinition({ filters: [], grouping: null, sort: [] });
    const v2Only = {
      ...definition,
      filter: {
        kind: 'not',
        child: {
          kind: 'predicate',
          field: 'assignee',
          operator: 'is',
          operand: { kind: 'current-actor' },
        },
      },
    } as const;

    expect(projectTaskViewDefinitionToLegacyFallback(v2Only)).toEqual({
      filters: [{ field: 'estimateMinutes', op: 'lt', value: 0 }],
      grouping: null,
      sort: [],
    });
  });

  it('migrates a flat Task view without changing its boolean meaning or order', () => {
    expect(
      migrateLegacyTaskViewDefinition({
        filters: [
          { field: 'priority', op: 'eq', value: 'high' },
          { field: 'assigneeId', op: 'eq', value: ID },
        ],
        grouping: { by: 'state', subBy: 'assigneeId' },
        sort: [{ field: 'dueDate', order: 'asc' }],
      }),
    ).toEqual({
      version: 2,
      target: 'task',
      filter: {
        kind: 'all',
        children: [
          { kind: 'predicate', field: 'priority', operator: 'is', operand: 'high' },
          {
            kind: 'predicate',
            field: 'assignee',
            operator: 'is',
            operand: { kind: 'actor', actorId: ID },
          },
        ],
      },
      arrangement: {
        groupBy: 'status',
        subGroupBy: 'assignee',
        orderBy: [{ field: 'dueDate', direction: 'asc' }],
      },
      presentation: {
        layout: 'list',
        properties: ['status', 'priority', 'assignee', 'dueDate'],
        density: 'comfortable',
        showEmptyGroups: false,
      },
    });
  });

  it('validates typed definitions, contextual attachment, position, and compatibility output', () => {
    const definition = migrateLegacyTaskViewDefinition({ filters: [], grouping: null, sort: [] });
    const create = SavedWorkViewCreate.parse({
      name: 'My Tasks',
      scope: 'team',
      teamId: ID,
      target: 'task',
      context: { kind: 'team', teamId: ID },
      position: 'a0',
      definition,
    });

    expect(create.schemaVersion).toBe(2);
    expect(
      SavedWorkViewOut.parse({
        id: ID,
        organizationId: ID,
        ownerActorId: ID,
        createdAt: '2026-08-20T12:00:00.000Z',
        updatedAt: '2026-08-20T12:00:00.000Z',
        ...create,
        filters: [],
        grouping: null,
        sort: [],
      }),
    ).toMatchObject({ target: 'task', schemaVersion: 2 });
    expect(
      OrganizationWorkViewDefault.parse({
        target: 'task',
        definition,
        updatedBy: ID,
        updatedAt: '2026-08-20T12:00:00.000Z',
      }),
    ).toMatchObject({ target: 'task' });
  });

  it('stores personal override, collapse, hidden-column, favorite, and last-layout state', () => {
    expect(
      HubPreferences.parse({
        viewState: [
          {
            instanceKey: `builtin:task:${ID}`,
            target: 'task',
            arrangement: { groupBy: 'assignee' },
            presentation: { density: 'compact' },
            collapsedGroups: ['status:done'],
            hiddenBoardColumns: ['status:canceled'],
            favoriteViewIds: [ID],
            lastUsedLayout: 'board',
          },
        ],
      }),
    ).toMatchObject({
      viewState: [{ target: 'task', lastUsedLayout: 'board', favoriteViewIds: [ID] }],
    });
  });

  it('parses updates against the stored immutable target', () => {
    const taskDefinition = migrateLegacyTaskViewDefinition({
      filters: [],
      grouping: null,
      sort: [],
    });
    const projectDefinition = ProjectViewDefinition.parse({
      version: 2,
      target: 'project',
      filter: null,
      arrangement: { groupBy: null, subGroupBy: null, orderBy: [] },
      presentation: {
        layout: 'list',
        properties: ['status'],
        density: 'comfortable',
        showEmptyGroups: false,
      },
    });
    expect(
      parseSavedWorkViewUpdate('project', {
        definition: projectDefinition,
        context: { kind: 'program', programId: ID },
      }),
    ).toMatchObject({ definition: { target: 'project' }, context: { kind: 'program' } });
    expect(() =>
      parseSavedWorkViewUpdate('project', {
        definition: taskDefinition,
        context: { kind: 'organization' },
      }),
    ).toThrow();
    expect(() =>
      parseSavedWorkViewUpdate('project', {
        definition: projectDefinition,
        context: { kind: 'project', projectId: ID },
      }),
    ).toThrow();
  });
});
