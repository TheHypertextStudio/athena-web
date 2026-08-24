import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  aggregateLoadState,
  terminalDetailFailure,
  initiativeDetailAggregateDef,
  programDetailAggregateDef,
  projectDetailAggregateDef,
  taskDetailAggregateDef,
} from '@/lib/detail-aggregate';
import { ApiRequestError } from '@/lib/query-core';

const ORG_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const ENTITY_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAW';

describe('detail aggregate query definitions', () => {
  it('keeps every aggregate response in a target-specific cache entry', () => {
    expect(taskDetailAggregateDef(ORG_ID, ENTITY_ID).queryKey).toEqual([
      'org',
      ORG_ID,
      'tasks',
      ENTITY_ID,
      'aggregate-detail',
    ]);
    expect(projectDetailAggregateDef(ORG_ID, ENTITY_ID).queryKey).toEqual([
      'org',
      ORG_ID,
      'projects',
      ENTITY_ID,
      'aggregate-detail',
    ]);
    expect(programDetailAggregateDef(ORG_ID, ENTITY_ID).queryKey).toEqual([
      'org',
      ORG_ID,
      'programs',
      ENTITY_ID,
      'aggregate-detail',
    ]);
    expect(initiativeDetailAggregateDef(ORG_ID, ENTITY_ID).queryKey).toEqual([
      'org',
      ORG_ID,
      'initiatives',
      ENTITY_ID,
      'aggregate-detail',
    ]);
  });

  it('keeps a cached aggregate visible when its background reconciliation fails', () => {
    expect(aggregateLoadState({ target: 'program' }, true, false, true)).toBe('data');
    expect(aggregateLoadState(undefined, true, false, true)).toBe('snapshot');
    expect(aggregateLoadState(undefined, false, true, false)).toBe('loading');
    expect(aggregateLoadState(undefined, false, false, true)).toBe('error');
  });

  it('does not retain a snapshot after the server reports deletion or revoked access', () => {
    expect(terminalDetailFailure(new ApiRequestError({ message: 'missing', status: 404 }))).toBe(
      'not-found',
    );
    expect(terminalDetailFailure(new ApiRequestError({ message: 'denied', status: 403 }))).toBe(
      'forbidden',
    );
    expect(
      terminalDetailFailure(new ApiRequestError({ message: 'retry', status: 500 })),
    ).toBeNull();
  });

  it('makes every locally cached detail target purge server-confirmed revocations and deletions', () => {
    const root = join(import.meta.dirname, '../..', 'src/app/(app)/orgs/[orgId]');
    const files = [
      'tasks/[taskId]/task-detail-client.tsx',
      'projects/[projectId]/project-detail-client.tsx',
      'programs/[programId]/program-detail-client.tsx',
      'initiatives/[initiativeId]/initiative-detail-client.tsx',
    ];

    for (const file of files) {
      const source = readFileSync(join(root, file), 'utf8');
      expect(source).toContain(
        file.startsWith('tasks/') ? 'terminalFailure' : 'terminalDetailFailure',
      );
      expect(source).toContain('removeNavigationSnapshot');
    }
    expect(
      readFileSync(join(import.meta.dirname, '../../src/lib/use-task-detail.ts'), 'utf8'),
    ).toContain('terminalDetailFailure');
  });
});
