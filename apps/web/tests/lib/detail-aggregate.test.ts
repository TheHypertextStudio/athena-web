import { describe, expect, it } from 'vitest';

import {
  initiativeDetailAggregateDef,
  programDetailAggregateDef,
  projectDetailAggregateDef,
  taskDetailAggregateDef,
} from '@/lib/detail-aggregate';

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
});
