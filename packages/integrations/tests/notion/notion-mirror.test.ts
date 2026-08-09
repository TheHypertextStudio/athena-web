import { NotionPropertyKind } from '@docket/types';
import { describe, expect, it } from 'vitest';

import { ConnectorError } from '../../src/connector-error';
import {
  columnSchema,
  databaseSchema,
  readPropertyIds,
  type MirrorColumnSpec,
} from '../../src/notion-mirror';

const col = (
  over: Partial<MirrorColumnSpec> & Pick<MirrorColumnSpec, 'kind'>,
): MirrorColumnSpec => ({
  field: over.field ?? 'f',
  title: over.title ?? 'T',
  kind: over.kind,
  ...(over.relationDataSourceId !== undefined
    ? { relationDataSourceId: over.relationDataSourceId }
    : {}),
  ...(over.options !== undefined ? { options: over.options } : {}),
});

describe('columnSchema', () => {
  it('emits a shape keyed by the Notion property type for every kind Docket declares', () => {
    // The catalog and the builder are the two halves of "Docket can provision this"; a kind the
    // builder cannot render would be a column the designer offers and provisioning then rejects.
    for (const kind of NotionPropertyKind.options) {
      const spec = col({
        kind,
        ...(kind === 'relation' ? { relationDataSourceId: 'ds_1' } : {}),
      });
      expect(Object.keys(columnSchema(spec)), kind).toEqual([kind]);
    }
  });

  it('carries select options through as Notion name objects', () => {
    expect(columnSchema(col({ kind: 'select', options: ['To do', 'Done'] }))).toEqual({
      select: { options: [{ name: 'To do' }, { name: 'Done' }] },
    });
  });

  it('sends an empty option list rather than omitting it when a select has no values yet', () => {
    // A brand-new workspace has no states to derive options from. Notion accepts an empty set and
    // the sync fills it in later; omitting `options` entirely is a 400.
    expect(columnSchema(col({ kind: 'select' }))).toEqual({ select: { options: [] } });
  });

  it('declares no options for a status property, because Notion owns its groups', () => {
    expect(columnSchema(col({ kind: 'status' }))).toEqual({ status: {} });
  });

  it('points a relation at its target data source', () => {
    expect(columnSchema(col({ kind: 'relation', relationDataSourceId: 'ds_42' }))).toEqual({
      relation: { data_source_id: 'ds_42', single_property: {} },
    });
  });

  it('refuses a relation with no target instead of guessing one', () => {
    // Guessing would silently wire the column to the wrong table, which is worse than failing:
    // the database provisions successfully and every row then relates to the wrong records.
    expect(() => columnSchema(col({ kind: 'relation', title: 'Project' }))).toThrow(ConnectorError);
    expect(() => columnSchema(col({ kind: 'relation', title: 'Project' }))).toThrow(/Project/);
  });
});

describe('databaseSchema', () => {
  it('keys the schema by column title, which is what Notion expects', () => {
    const schema = databaseSchema([
      col({ field: 'title', title: 'Task name', kind: 'title' }),
      col({ field: 'dueDate', title: 'Due', kind: 'date' }),
    ]);
    expect(Object.keys(schema)).toEqual(['Task name', 'Due']);
  });

  it('uses the user-chosen title, not the Docket field key', () => {
    const schema = databaseSchema([col({ field: 'assignee', title: 'DRI', kind: 'rich_text' })]);
    expect(schema).toHaveProperty('DRI');
    expect(schema).not.toHaveProperty('assignee');
  });
});

describe('readPropertyIds', () => {
  it('correlates Docket fields to Notion property ids by the title Docket just chose', () => {
    // This is the only moment the two can be correlated unambiguously — right after Docket named
    // the columns. Every later call binds by the id captured here.
    const ids = readPropertyIds(
      [
        col({ field: 'title', title: 'Task name', kind: 'title' }),
        col({ field: 'assignee', title: 'Owner', kind: 'rich_text' }),
      ],
      { 'Task name': { id: 'title' }, Owner: { id: 'a%3Db' } },
    );
    expect(ids).toEqual({ title: 'title', assignee: 'a%3Db' });
  });

  it('omits a column Notion did not create rather than recording a blank id', () => {
    // A binding with an empty id would look provisioned and then address nothing.
    const ids = readPropertyIds(
      [
        col({ field: 'title', title: 'Name', kind: 'title' }),
        col({ field: 'ghost', title: 'Ghost', kind: 'rich_text' }),
      ],
      { Name: { id: 'title' } },
    );
    expect(ids).toEqual({ title: 'title' });
  });

  it('ignores a property whose id came back empty', () => {
    const ids = readPropertyIds([col({ field: 'title', title: 'Name', kind: 'title' })], {
      Name: { id: '' },
    });
    expect(ids).toEqual({});
  });
});
