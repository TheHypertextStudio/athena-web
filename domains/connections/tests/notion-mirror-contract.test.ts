/** The Notion mirror grammar belongs to Connections, independent of its SDK adapter. */
import { describe, expect, it } from 'vitest';

import * as contract from '../src/notion/mirror-contract';

describe('Connections Notion mirror contract', () => {
  it('owns the complete public runtime schema surface', () => {
    expect(Object.keys(contract).sort()).toEqual([
      'NotionColumnBinding',
      'NotionMirrorContentStatus',
      'NotionMirrorDatabaseOut',
      'NotionMirrorDesignOut',
      'NotionMirrorDesignPatch',
      'NotionMirrorDirection',
      'NotionMirrorEntity',
      'NotionMirrorFieldOut',
      'NotionMirrorPreviewRow',
      'NotionParentPageOut',
      'NotionPersonRepresentation',
      'NotionPersonResolve',
      'NotionPropertyKind',
      'NotionPropertyMap',
      'NotionWorkspacePerson',
    ]);
  });

  it('keeps a provisioned database serializable by property id instead of display title', () => {
    const database = {
      id: 'mirror_1',
      entityType: 'task' as const,
      title: 'Tasks',
      enabled: true,
      direction: 'two_way' as const,
      content: {
        state: 'complete' as const,
        unknownBlockCount: 0,
      },
      propertyMap: {
        title: {
          field: 'title',
          title: 'Task name',
          kind: 'title' as const,
          order: 0,
          propertyId: 'notion_property_title',
        },
      },
      externalDatabaseId: 'notion_database_1',
      externalDataSourceId: 'notion_data_source_1',
      externalUrl: 'https://www.notion.so/notion_database_1',
      rowCount: 3,
      provisionedAt: '2026-08-13T00:00:00.000Z',
      lastPushedAt: '2026-08-13T00:00:01.000Z',
      lastPulledAt: null,
    };

    expect(contract.NotionMirrorDatabaseOut.parse(database)).toEqual(database);
  });

  it('keeps the designer patch intentionally narrower than the provisioned database', () => {
    expect(
      contract.NotionMirrorDesignPatch.parse({
        title: 'Campaigns',
        columns: [
          {
            field: 'owner',
            title: 'Owner',
            representation: 'existing_table',
            relationDataSourceId: 'people_data_source',
          },
        ],
      }),
    ).toEqual({
      title: 'Campaigns',
      columns: [
        {
          field: 'owner',
          title: 'Owner',
          representation: 'existing_table',
          relationDataSourceId: 'people_data_source',
        },
      ],
    });
    expect(
      contract.NotionMirrorDesignPatch.parse({
        columns: [{ field: 'title', title: 'Title', propertyId: 'server-owned' }],
      }),
    ).toEqual({ columns: [{ field: 'title', title: 'Title' }] });
  });
});
