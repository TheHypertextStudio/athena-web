import { describe, expect, it } from 'vitest';

import { TaskViewDefinition } from '@docket/work/work-view-contract';

import { buildWorkViewFacetRequest } from '../../src/components/work-views/use-work-view';
import { queryKeys } from '../../src/lib/query';

const definition = TaskViewDefinition.parse({
  version: 2,
  target: 'task',
  filter: { kind: 'predicate', field: 'priority', operator: 'is', operand: 'high' },
  arrangement: { groupBy: 'status', subGroupBy: null, orderBy: [] },
  presentation: {
    layout: 'list',
    properties: ['status', 'assignee'],
    density: 'compact',
    showEmptyGroups: false,
  },
});

describe('work-view controller facets', () => {
  it('binds facet reads to the active definition, URL refinement, context, search, and timezone', () => {
    const temporaryFilter = {
      kind: 'predicate',
      field: 'dueDate',
      operator: 'before',
      operand: { kind: 'preset', value: 'next-week' },
    } as const;
    const request = buildWorkViewFacetRequest({
      target: 'task',
      field: 'assignee',
      definition,
      temporaryFilter,
      context: { kind: 'organization' },
      search: '  alex  ',
    });
    const key = queryKeys.workViewFacets(
      'org-1',
      'task',
      'builtin:task:org-1',
      JSON.stringify(request),
      'America/Los_Angeles',
    );

    expect(request).toMatchObject({
      target: 'task',
      fields: ['assignee'],
      definition,
      temporaryFilter,
      context: { kind: 'organization' },
      search: 'alex',
      limit: 50,
    });
    expect(key).toContain('America/Los_Angeles');
    expect(key).toContain(JSON.stringify(request));
  });
});
