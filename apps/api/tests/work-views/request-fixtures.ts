import type { z } from 'zod';

import {
  ProgramWorkViewQueryRequest,
  ProjectWorkViewQueryRequest,
  TaskWorkViewQueryRequest,
} from '@docket/types';
import type { InitiativeWorkViewQueryRequest } from '@docket/types';

/** Validated Task query fixture input. */
export type TaskQueryRequest = z.output<typeof TaskWorkViewQueryRequest>;
/** Validated Project query fixture input. */
export type ProjectQueryRequest = z.output<typeof ProjectWorkViewQueryRequest>;
/** Validated Program query fixture input. */
export type ProgramQueryRequest = z.output<typeof ProgramWorkViewQueryRequest>;
/** Validated Initiative query fixture input. */
export type InitiativeQueryRequest = z.output<typeof InitiativeWorkViewQueryRequest>;

/** Build a validated Task work-view request with focused overrides. */
export function taskRequest(over: Partial<TaskQueryRequest> = {}): TaskQueryRequest {
  return TaskWorkViewQueryRequest.parse({
    target: 'task',
    definition: {
      version: 2,
      target: 'task',
      filter: null,
      arrangement: { groupBy: null, subGroupBy: null, orderBy: [] },
      presentation: {
        layout: 'list',
        properties: ['status', 'priority'],
        density: 'comfortable',
        showEmptyGroups: false,
      },
    },
    temporaryFilter: null,
    context: { kind: 'organization' },
    limit: 100,
    ...over,
  });
}

/** Build a validated Project work-view request with focused overrides. */
export function projectRequest(over: Partial<ProjectQueryRequest> = {}): ProjectQueryRequest {
  return ProjectWorkViewQueryRequest.parse({
    target: 'project',
    definition: {
      version: 2,
      target: 'project',
      filter: null,
      arrangement: { groupBy: null, subGroupBy: null, orderBy: [] },
      presentation: {
        layout: 'list',
        properties: ['status', 'priority'],
        density: 'comfortable',
        showEmptyGroups: false,
      },
    },
    temporaryFilter: null,
    context: { kind: 'organization' },
    limit: 100,
    ...over,
  });
}

/** Build a validated Program work-view request with focused overrides. */
export function programRequest(over: Partial<ProgramQueryRequest> = {}): ProgramQueryRequest {
  return ProgramWorkViewQueryRequest.parse({
    target: 'program',
    definition: {
      version: 2,
      target: 'program',
      filter: null,
      arrangement: { groupBy: null, subGroupBy: null, orderBy: [] },
      presentation: {
        layout: 'list',
        properties: ['status', 'health'],
        density: 'comfortable',
        showEmptyGroups: false,
      },
    },
    temporaryFilter: null,
    context: { kind: 'organization' },
    limit: 100,
    ...over,
  });
}
