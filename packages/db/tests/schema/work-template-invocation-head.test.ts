import { getTableColumns, getTableName } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { invocationHead } from '../../src/schema/work-template-invocation-head';

describe('private compatibility invocation heads', () => {
  it('owns metadata and private document pointers without another work execution model', () => {
    expect(Object.keys(getTableColumns(invocationHead))).toEqual([
      'id',
      'organizationId',
      'createdBy',
      'createdAt',
      'updatedAt',
      'archivedAt',
      'ownerActorId',
      'name',
      'description',
      'status',
      'revision',
      'canonicalAuthoringAt',
      'identityOrigin',
      'identityReview',
      'draftInvocationId',
      'publishedInvocationId',
    ]);
    expect(getTableColumns(invocationHead).canonicalAuthoringAt.notNull).toBe(false);
    const config = getTableConfig(invocationHead);
    expect(config.enableRLS).toBe(true);
    expect(config.policies.map((policy) => policy.name)).toContain('invocation_head_private');
    expect(config.foreignKeys.map((key) => getTableName(key.reference().foreignTable))).toEqual(
      expect.arrayContaining(['organization', 'actor', 'work_template_blueprint_invocation']),
    );
  });
  it('requires the metadata owner to belong to the same tenant', () => {
    const ownerKey = getTableConfig(invocationHead).foreignKeys.find(
      (key) => key.getName() === 'invocation_head_owner_tenant_fk',
    );
    expect(ownerKey?.reference().columns.map((column) => column.name)).toEqual([
      'owner_actor_id',
      'organization_id',
    ]);
    expect(ownerKey?.reference().foreignColumns.map((column) => column.name)).toEqual([
      'id',
      'organization_id',
    ]);
  });
});
