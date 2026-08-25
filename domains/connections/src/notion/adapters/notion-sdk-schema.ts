/** SDK-backed schema translation for the designed Notion mirror. */
import type { CreateDatabaseParameters, UpdateDataSourceParameters } from '@notionhq/client';

import type { NotionPropertyKind } from '../mirror-contract';
import type { MirrorColumnSpec } from '../mirror-port';
import { ProviderError } from '../../provider-error';

/** Managed column that makes page creation recoverable without relying on a title. */
export const DOCKET_ID_PROPERTY_TITLE = 'Docket ID';

/** The property map accepted when a database creates its initial data source. */
type SdkPropertySchemaMap = NonNullable<
  NonNullable<CreateDatabaseParameters['initial_data_source']>['properties']
>;

/** Assert that a narrow shape remains assignable to the SDK's wider shape. */
type AssertSubset<Narrow extends Wide, Wide> = Narrow;

/** One create-path property shape from the installed Notion SDK. */
type SdkPropertySchema = SdkPropertySchemaMap[string];

/** The property map accepted when an existing data source is updated. */
type SdkUpdatePropertySchemaMap = NonNullable<UpdateDataSourceParameters['properties']>;

/** The only property shapes Docket's mirror emits. */
export type DocketPropertySchema =
  | { title: Record<string, never> }
  | { rich_text: Record<string, never> }
  | { number: Record<string, never> }
  | { checkbox: Record<string, never> }
  | { date: Record<string, never> }
  | { url: Record<string, never> }
  | { email: Record<string, never> }
  | { people: Record<string, never> }
  | { status: Record<string, never> }
  | { select: { options: { name: string }[] } }
  | { multi_select: { options: { name: string }[] } }
  | { relation: { data_source_id: string; single_property: Record<string, never> } };

/** Compile-time proof one schema builder is valid on both Notion write endpoints. */
export type NotionSchemaIsSdkBacked = [
  AssertSubset<DocketPropertySchema, SdkPropertySchema>,
  AssertSubset<DocketPropertySchema, SdkUpdatePropertySchemaMap[string]>,
];

/** Every createable Notion property name, derived from the SDK instead of duplicated. */
type SdkPropertyTypeName = SdkPropertySchema extends infer Schema
  ? Schema extends object
    ? keyof Schema
    : never
  : never;

/** Compile-time proof the mirror catalog uses only property kinds the SDK supports. */
export type NotionPropertyKindIsSdkBacked = AssertSubset<NotionPropertyKind, SdkPropertyTypeName>;

/** Build the SDK property schema for one designed column. */
export function columnSchema(column: MirrorColumnSpec): DocketPropertySchema {
  switch (column.kind) {
    case 'title':
      return { title: {} };
    case 'rich_text':
      return { rich_text: {} };
    case 'number':
      return { number: {} };
    case 'checkbox':
      return { checkbox: {} };
    case 'date':
      return { date: {} };
    case 'url':
      return { url: {} };
    case 'email':
      return { email: {} };
    case 'people':
      return { people: {} };
    case 'select':
      return { select: { options: (column.options ?? []).map((name) => ({ name })) } };
    case 'multi_select':
      return { multi_select: { options: (column.options ?? []).map((name) => ({ name })) } };
    case 'status':
      // Notion owns a status property's groups and rejects explicit options on create.
      return { status: {} };
    case 'relation': {
      const dataSourceId = column.relationDataSourceId;
      if (dataSourceId === undefined) {
        throw new ProviderError(
          `Notion relation column "${column.title}" has no target data source`,
          {
            provider: 'notion',
            kind: 'provider',
          },
        );
      }
      return { relation: { data_source_id: dataSourceId, single_property: {} } };
    }
  }
}

/** Build the full property-schema map for a designed database. */
export function databaseSchema(
  columns: readonly MirrorColumnSpec[],
): Record<string, DocketPropertySchema> {
  const schema: Record<string, DocketPropertySchema> = {
    [DOCKET_ID_PROPERTY_TITLE]: { rich_text: {} },
  };
  for (const column of columns) schema[column.title] = columnSchema(column);
  return schema;
}

/** Read Docket field keys back from the property ids Notion assigned to their titles. */
export function readPropertyIds(
  columns: readonly MirrorColumnSpec[],
  properties: Readonly<Record<string, { id?: string } | undefined>>,
): Record<string, string> {
  const ids: Record<string, string> = {};
  for (const column of columns) {
    const id = properties[column.title]?.id;
    if (typeof id === 'string' && id.length > 0) ids[column.field] = id;
  }
  return ids;
}

/** Read the stable id Notion assigned to the managed Docket ID property. */
export function readDocketIdPropertyId(
  properties: Readonly<Record<string, { id?: string } | undefined>>,
): string {
  const id = properties[DOCKET_ID_PROPERTY_TITLE]?.id;
  if (typeof id === 'string' && id.length > 0) return id;
  throw new ProviderError('Notion database has no Docket ID property', {
    provider: 'notion',
    kind: 'provider',
  });
}
