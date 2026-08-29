import type { ViewTarget } from '@docket/work/view-contract';
import { describe, expect, it } from 'vitest';

import { queryKeys, workTargetCollectionKey } from '@/lib/query-keys';

const TARGETS: readonly ViewTarget[] = ['task', 'project', 'program', 'initiative'];

const COLLECTION_KEYS = {
  task: ['org', 'route-org', 'tasks'],
  project: ['org', 'route-org', 'projects'],
  program: ['org', 'route-org', 'programs'],
  initiative: ['org', 'route-org', 'initiatives'],
} as const satisfies Record<ViewTarget, readonly string[]>;

describe('work target query keys', () => {
  it.each(TARGETS)('maps %s to its entity collection', (target) => {
    expect(workTargetCollectionKey('route-org', target)).toEqual(COLLECTION_KEYS[target]);
  });

  it.each(TARGETS)('nests the %s roster below its entity collection', (target) => {
    const collection = workTargetCollectionKey('route-org', target);
    const roster = queryKeys.workView(
      'route-org',
      target,
      `builtin:${target}:instance`,
      'request',
      'America/Los_Angeles',
    );

    expect(roster.slice(0, 3)).toEqual(collection);
    expect(roster).toEqual([
      ...COLLECTION_KEYS[target],
      'work-view',
      target,
      `builtin:${target}:instance`,
      'America/Los_Angeles',
      'request',
    ]);
  });

  it.each(TARGETS)('nests the %s facets below its entity collection', (target) => {
    const collection = workTargetCollectionKey('route-org', target);
    const facets = queryKeys.workViewFacets(
      'route-org',
      target,
      `builtin:${target}:instance`,
      'request',
      'America/Los_Angeles',
    );

    expect(facets.slice(0, 3)).toEqual(collection);
    expect(facets).toEqual([
      ...COLLECTION_KEYS[target],
      'work-view-facets',
      target,
      `builtin:${target}:instance`,
      'America/Los_Angeles',
      'request',
    ]);
  });

  it('keeps Initiative work views out of the Project collection', () => {
    const initiativeRoster = queryKeys.workView(
      'route-org',
      'initiative',
      'builtin:initiative:instance',
      'request',
      'America/Los_Angeles',
    );

    expect(initiativeRoster.slice(0, 3)).toEqual(queryKeys.initiatives('route-org'));
    expect(initiativeRoster.slice(0, 3)).not.toEqual(queryKeys.projects('route-org'));
  });
});
