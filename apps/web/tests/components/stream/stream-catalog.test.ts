import { describe, expect, it } from 'vitest';

import { buildStreamCatalog } from '@/components/stream/stream-catalog';
import {
  filterableFields,
  groupableFields,
  sortableFields,
} from '@/components/views/field-catalog';

describe('buildStreamCatalog', () => {
  it('offers filters without controls that can restructure chronology', () => {
    const catalog = buildStreamCatalog({ scope: 'me' });
    expect(filterableFields(catalog).map((field) => field.key)).toEqual([
      'system',
      'kind',
      'organizationId',
      'entityKind',
      'actor',
      'occurredAt',
    ]);
    expect(groupableFields(catalog)).toEqual([]);
    expect(sortableFields(catalog)).toEqual([]);
  });
});
