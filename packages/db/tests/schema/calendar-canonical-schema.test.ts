import { getTableColumns } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import {
  calendarItem,
  calendarLayer,
  calendarList,
  calendarSourceGroup,
  calendarSourceGroupMember,
} from '../../src/schema';

describe('canonical calendar source persistence', () => {
  it('stores provider-neutral source identity and soft-removal state', () => {
    expect(Object.keys(getTableColumns(calendarList))).toEqual(
      expect.arrayContaining(['removedAt']),
    );
    expect(Object.keys(getTableColumns(calendarLayer))).toEqual(
      expect.arrayContaining([
        'sourceIdentityNamespace',
        'sourceIdentityValue',
        'sourceRelationship',
        'sourceManagement',
        'suggestedGroupKey',
        'removedAt',
      ]),
    );
  });

  it('stores provider-neutral event and recurring-occurrence identity', () => {
    expect(Object.keys(getTableColumns(calendarItem))).toEqual(
      expect.arrayContaining([
        'eventIdentityNamespace',
        'eventIdentityValue',
        'occurrenceIdentity',
      ]),
    );
  });

  it('assigns each layer to at most one confirmed source group', () => {
    const groupColumns = getTableConfig(calendarSourceGroup).columns.map((column) => column.name);
    expect(groupColumns).toEqual(
      expect.arrayContaining(['id', 'user_id', 'preferred_layer_id', 'created_at', 'updated_at']),
    );

    const memberConfig = getTableConfig(calendarSourceGroupMember);
    expect(memberConfig.columns.map((column) => column.name)).toEqual(['group_id', 'layer_id']);
    expect(memberConfig.primaryKeys[0]?.columns.map((column) => column.name)).toEqual([
      'group_id',
      'layer_id',
    ]);
    expect(memberConfig.uniqueConstraints).toHaveLength(1);
    expect(memberConfig.uniqueConstraints[0]?.columns.map((column) => column.name)).toEqual([
      'layer_id',
    ]);
  });
});
