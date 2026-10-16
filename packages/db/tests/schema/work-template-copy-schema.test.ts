import { getTableColumns } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { workTemplateCopyBundle, workTemplateCopyEntry } from '../../src/schema/work-template-copy';

describe('private copy identity metadata', () => {
  it('keeps audit identities alongside nullable live references and enables private RLS', () => {
    const bundle = getTableColumns(workTemplateCopyBundle);
    const entry = getTableColumns(workTemplateCopyEntry);
    expect(bundle.acceptingActorKey.notNull).toBe(true);
    expect(bundle.acceptingActorId.notNull).toBe(false);
    expect(bundle.receiptKey.notNull).toBe(false);
    expect(entry.destinationWorkTypeId.notNull).toBe(true);
    expect(entry.liveWorkTypeId.notNull).toBe(false);
    expect(entry.reservedFirstVersionId.notNull).toBe(true);
    expect(entry.consumedVersionId.notNull).toBe(false);
    expect(getTableConfig(workTemplateCopyBundle).enableRLS).toBe(true);
    expect(getTableConfig(workTemplateCopyEntry).enableRLS).toBe(true);
  });
  it('retains exact tenant/template/version foreign keys without cascading live destinations', () => {
    const keys = getTableConfig(workTemplateCopyEntry).foreignKeys;
    const live = keys.find((key) => key.getName() === 'copy_entry_live_destination_fk');
    const consumed = keys.find((key) => key.getName() === 'copy_entry_consumed_version_fk');
    expect(live?.onDelete).toBe('no action');
    expect(live?.reference().columns.map((column) => column.name)).toEqual([
      'live_work_type_id',
      'organization_id',
    ]);
    expect(consumed?.reference().columns.map((column) => column.name)).toEqual([
      'consumed_version_id',
      'live_work_type_id',
      'organization_id',
    ]);
    expect(consumed?.reference().foreignColumns.map((column) => column.name)).toEqual([
      'id',
      'work_type_id',
      'organization_id',
    ]);
  });
});
