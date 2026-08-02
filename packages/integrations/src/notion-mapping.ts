/**
 * `@docket/integrations` — the pure Notion ⇄ Docket property mapping.
 *
 * @remarks
 * Notion has no fixed task schema: every database (a *data source*, in the 2025-09-03 API)
 * declares its own property names and types. So the mapping cannot be a hard-coded field list —
 * it has to be derived from the data source's own schema at sync time. {@link readNotionSchema}
 * does that derivation once per data source; every other function here consumes the derived
 * {@link NotionSchema} and is a pure function of it, so the whole mapping is unit-testable with
 * no network.
 *
 * The role assignment was designed against the REAL Las Vegans for Better Transit databases
 * (`Tasks Tracker`: Task name/Status/Assignee/Due date/Priority/Description/Project/Effort
 * level/Parent Task/Subtasks/Updated at, and the built-in `My Tasks` task database:
 * Task name/Status/Due/Assignee/Source), not against an invented example — see
 * `docs/engineering/specs/notion-sync.md` for the field-by-field table and the list of fields
 * that deliberately do not map.
 *
 * Completion is read from Notion's `status` property **groups** (`to_do` / `in_progress` /
 * `complete`) rather than from option names, because the option names are workspace-authored
 * ("Done", "Substantially complete", "Complete") while the groups are Notion's own semantics.
 */
import type { ImportedItem, TaskPushOp } from './connector';
import { asRecord, str } from './json';

/** The Notion API version this adapter speaks (the data-sources release). */
export const NOTION_API_VERSION = '2025-09-03';

/**
 * The Notion property types this mapping understands.
 *
 * @remarks
 * Anything outside this list is carried as *unmapped* rather than silently dropped: the sync
 * spec enumerates every unmapped type and why it has no Docket destination.
 */
export const NOTION_MAPPED_PROPERTY_TYPES = [
  'title',
  'rich_text',
  'status',
  'checkbox',
  'date',
  'select',
  'people',
  'last_edited_time',
  'relation',
] as const;
/** One understood Notion property type. */
export type NotionMappedPropertyType = (typeof NOTION_MAPPED_PROPERTY_TYPES)[number];

/**
 * The Docket-facing role a Notion property plays, once resolved against a data source's schema.
 *
 * @remarks
 * `title` and `status`/`checkbox` are structural (Notion guarantees exactly one title property;
 * completion is whichever status/checkbox property exists). The rest are resolved by preferring
 * a name match and falling back to the first property of the right type, so a workspace that
 * renamed "Due date" to "Due" (as Notion's built-in task database does) still maps.
 */
export interface NotionSchema {
  /** The data source id these properties belong to. */
  readonly dataSourceId: string;
  /** The data source's human-readable title. */
  readonly title: string;
  /** The name of the (single) `title` property — Docket's task title. */
  readonly titleProperty: string;
  /** The `status` property name driving completion, when the data source has one. */
  readonly statusProperty: string | null;
  /** The `checkbox` property name driving completion when there is no `status` property. */
  readonly checkboxProperty: string | null;
  /** The `date` property name carrying the due date, when present. */
  readonly dueDateProperty: string | null;
  /** The `rich_text` property name carrying the description, when present. */
  readonly descriptionProperty: string | null;
  /** The `select` property name carrying priority, when present. */
  readonly priorityProperty: string | null;
  /** The `people` property name carrying assignees, when present. */
  readonly assigneeProperty: string | null;
  /** Status option names grouped by Notion's own `to_do` / `in_progress` / `complete` groups. */
  readonly statusGroups: NotionStatusGroups;
  /** Property names present on the data source that this mapping does not carry into Docket. */
  readonly unmappedProperties: readonly NotionUnmappedProperty[];
}

/** Status option names split by Notion's semantic groups. */
export interface NotionStatusGroups {
  /** Options in the `to_do` group. */
  readonly todo: readonly string[];
  /** Options in the `in_progress` group. */
  readonly inProgress: readonly string[];
  /** Options in the `complete` group. */
  readonly complete: readonly string[];
}

/** A Notion property carried no further than the sync report. */
export interface NotionUnmappedProperty {
  /** The property's name in Notion. */
  readonly name: string;
  /** The property's Notion type. */
  readonly type: string;
}

/** The completion-driving property resolved for one data source. */
export type NotionCompletionProperty =
  | { readonly kind: 'status'; readonly name: string; readonly groups: NotionStatusGroups }
  | { readonly kind: 'checkbox'; readonly name: string }
  | { readonly kind: 'none' };

/** Candidate names, in preference order, for the property carrying a due date. */
const DUE_DATE_NAMES = ['due date', 'due', 'deadline', 'due on'] as const;
/** Candidate names, in preference order, for the property carrying a description. */
const DESCRIPTION_NAMES = ['description', 'notes', 'details', 'summary'] as const;
/** Candidate names, in preference order, for the property carrying a priority. */
const PRIORITY_NAMES = ['priority', 'urgency'] as const;
/** Candidate names, in preference order, for the property carrying assignees. */
const ASSIGNEE_NAMES = ['assignee', 'assigned to', 'owner', 'person'] as const;

/**
 * Pick a property of a given Notion type, preferring one whose (case-insensitive) name is in
 * `preferred` and otherwise taking the first of that type in declaration order.
 *
 * @param properties - The data source's `properties` map, as returned by the Notion API.
 * @param type - The Notion property type to look for.
 * @param preferred - Lower-cased candidate names in preference order.
 * @returns the chosen property name, or `null` when the data source has none of that type.
 */
function pickProperty(
  properties: Readonly<Record<string, unknown>>,
  type: string,
  preferred: readonly string[] = [],
): string | null {
  const ofType = Object.entries(properties).filter(
    ([, value]) => str(asRecord(value), 'type') === type,
  );
  if (ofType.length === 0) return null;
  for (const candidate of preferred) {
    const match = ofType.find(([name]) => name.trim().toLowerCase() === candidate);
    if (match) return match[0];
  }
  return ofType[0]?.[0] ?? null;
}

/** Read the option names of one `status` group out of a Notion status property definition. */
function statusGroupNames(
  statusDefinition: Record<string, unknown> | undefined,
  group: 'to_do' | 'in_progress' | 'complete',
): readonly string[] {
  const status = asRecord(statusDefinition?.['status']);
  const groups = status?.['groups'];
  if (Array.isArray(groups)) {
    // Notion's REST shape: `groups: [{ name: 'To-do', option_ids: [...] }]` plus `options`.
    const optionsById = new Map<string, string>();
    const options = status?.['options'];
    if (Array.isArray(options)) {
      for (const option of options) {
        const rec = asRecord(option);
        const id = str(rec, 'id');
        const name = str(rec, 'name');
        if (id && name) optionsById.set(id, name);
      }
    }
    const matched: unknown = groups.find((g: unknown) => {
      const name = str(asRecord(g), 'name') ?? '';
      return normalizeGroupName(name) === group;
    });
    const ids = asRecord(matched)?.['option_ids'];
    if (!Array.isArray(ids)) return [];
    return ids
      .map((id) => (typeof id === 'string' ? optionsById.get(id) : undefined))
      .filter((name): name is string => name !== undefined);
  }
  // Keyed shape (`groups: { to_do: [{ name }], … }`) — what the Notion MCP surface returns.
  const keyed = asRecord(groups);
  const bucket = keyed?.[group];
  if (!Array.isArray(bucket)) return [];
  return bucket
    .map((option) => str(asRecord(option), 'name'))
    .filter((name): name is string => name !== undefined);
}

/** Normalize a Notion status group's display name ("To-do", "In progress") to its semantic key. */
function normalizeGroupName(name: string): 'to_do' | 'in_progress' | 'complete' | 'other' {
  const key = name
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (key === 'to_do' || key === 'todo') return 'to_do';
  if (key === 'in_progress') return 'in_progress';
  if (key === 'complete' || key === 'completed' || key === 'done') return 'complete';
  return 'other';
}

/**
 * Derive the Docket-facing {@link NotionSchema} from a Notion data source's own property map.
 *
 * @remarks
 * The single place a Notion database's shape becomes Docket's; every other function in this
 * module takes the result rather than re-reading raw Notion JSON. Properties the mapping does not
 * carry are recorded in {@link NotionSchema.unmappedProperties} so the sync report can name them
 * instead of dropping them silently.
 *
 * @param dataSourceId - The Notion data source id.
 * @param title - The data source's display title.
 * @param properties - The data source's `properties` map from `GET /v1/data_sources/{id}`.
 *
 * @example
 * ```typescript
 * const schema = readNotionSchema(id, 'Tasks Tracker', payload.properties);
 * schema.titleProperty; // 'Task name'
 * ```
 */
export function readNotionSchema(
  dataSourceId: string,
  title: string,
  properties: Readonly<Record<string, unknown>>,
): NotionSchema {
  const titleProperty = pickProperty(properties, 'title') ?? 'Name';
  const statusProperty = pickProperty(properties, 'status');
  const checkboxProperty = statusProperty === null ? pickProperty(properties, 'checkbox') : null;
  const dueDateProperty = pickProperty(properties, 'date', DUE_DATE_NAMES);
  const descriptionProperty = pickProperty(properties, 'rich_text', DESCRIPTION_NAMES);
  const priorityProperty = pickProperty(properties, 'select', PRIORITY_NAMES);
  const assigneeProperty = pickProperty(properties, 'people', ASSIGNEE_NAMES);
  const statusDefinition = statusProperty ? asRecord(properties[statusProperty]) : undefined;

  const mappedNames = new Set(
    [
      titleProperty,
      statusProperty,
      checkboxProperty,
      dueDateProperty,
      descriptionProperty,
      priorityProperty,
      assigneeProperty,
    ].filter((name): name is string => name !== null),
  );
  const unmappedProperties: NotionUnmappedProperty[] = [];
  for (const [name, definition] of Object.entries(properties)) {
    if (mappedNames.has(name)) continue;
    unmappedProperties.push({ name, type: str(asRecord(definition), 'type') ?? 'unknown' });
  }

  return {
    dataSourceId,
    title,
    titleProperty,
    statusProperty,
    checkboxProperty,
    dueDateProperty,
    descriptionProperty,
    priorityProperty,
    assigneeProperty,
    statusGroups: {
      todo: statusGroupNames(statusDefinition, 'to_do'),
      inProgress: statusGroupNames(statusDefinition, 'in_progress'),
      complete: statusGroupNames(statusDefinition, 'complete'),
    },
    unmappedProperties,
  };
}

/** The property (if any) whose value decides whether a Notion page is done. */
export function completionProperty(schema: NotionSchema): NotionCompletionProperty {
  if (schema.statusProperty !== null) {
    return { kind: 'status', name: schema.statusProperty, groups: schema.statusGroups };
  }
  if (schema.checkboxProperty !== null) {
    return { kind: 'checkbox', name: schema.checkboxProperty };
  }
  return { kind: 'none' };
}

/** Flatten a Notion rich-text array into plain text (`plain_text` segments, joined). */
export function notionPlainText(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value
    .map((segment) => str(asRecord(segment), 'plain_text') ?? '')
    .join('')
    .trim();
}

/** Read one property value object off a Notion page's `properties` map. */
function pageProperty(
  page: Readonly<Record<string, unknown>>,
  name: string | null,
): Record<string, unknown> | undefined {
  if (name === null) return undefined;
  const properties = asRecord(page['properties']);
  return asRecord(properties?.[name]);
}

/**
 * Read whether a Notion page is complete.
 *
 * @remarks
 * Reads the **group** the page's status option belongs to, not the option's name — a workspace
 * is free to call its done column "Shipped". A page whose status is unset is not complete, and a
 * data source with neither a status nor a checkbox property reports `undefined` (unknown), which
 * the caller must not coerce to "not done".
 *
 * @param page - The Notion page object.
 * @param schema - The derived schema for the page's data source.
 */
export function readNotionCompleted(
  page: Readonly<Record<string, unknown>>,
  schema: NotionSchema,
): boolean | undefined {
  const completion = completionProperty(schema);
  if (completion.kind === 'none') return undefined;
  if (completion.kind === 'checkbox') {
    const value = pageProperty(page, completion.name)?.['checkbox'];
    return typeof value === 'boolean' ? value : undefined;
  }
  const status = asRecord(pageProperty(page, completion.name)?.['status']);
  const optionName = str(status, 'name');
  if (optionName === undefined) return false;
  return completion.groups.complete.some(
    (candidate) => candidate.toLowerCase() === optionName.toLowerCase(),
  );
}

/**
 * Read a Notion date property's start value as an RFC3339 date (`YYYY-MM-DD`) or datetime.
 *
 * @returns the ISO string, `null` when the property exists but is cleared, `undefined` when the
 * data source has no date property at all (so a push never clears a field it cannot see).
 */
export function readNotionDueDate(
  page: Readonly<Record<string, unknown>>,
  schema: NotionSchema,
): string | null | undefined {
  if (schema.dueDateProperty === null) return undefined;
  const property = pageProperty(page, schema.dueDateProperty);
  if (property === undefined) return undefined;
  const date = asRecord(property['date']);
  if (date === undefined) return null;
  return str(date, 'start') ?? null;
}

/** Read the page's title text (Notion guarantees exactly one `title` property per data source). */
export function readNotionTitle(
  page: Readonly<Record<string, unknown>>,
  schema: NotionSchema,
): string {
  return notionPlainText(pageProperty(page, schema.titleProperty)?.['title']);
}

/** Read the page's mapped description text, or `undefined` when the schema has no such property. */
export function readNotionDescription(
  page: Readonly<Record<string, unknown>>,
  schema: NotionSchema,
): string | undefined {
  if (schema.descriptionProperty === null) return undefined;
  return notionPlainText(pageProperty(page, schema.descriptionProperty)?.['rich_text']);
}

/** Read the page's mapped priority option name, when the schema has a priority property. */
export function readNotionPriority(
  page: Readonly<Record<string, unknown>>,
  schema: NotionSchema,
): string | undefined {
  if (schema.priorityProperty === null) return undefined;
  const select = asRecord(pageProperty(page, schema.priorityProperty)?.['select']);
  return str(select, 'name');
}

/** Read the Notion user ids on the page's mapped people property. */
export function readNotionAssignees(
  page: Readonly<Record<string, unknown>>,
  schema: NotionSchema,
): readonly string[] {
  if (schema.assigneeProperty === null) return [];
  const people = pageProperty(page, schema.assigneeProperty)?.['people'];
  if (!Array.isArray(people)) return [];
  return people
    .map((person) => str(asRecord(person), 'id'))
    .filter((id): id is string => id !== undefined);
}

/**
 * The canonical `notion.so` URL for a page id.
 *
 * @remarks
 * Notion's own `url` field is preferred when the payload carries one; this is the fallback for
 * link resolution, where only the id is known.
 *
 * @param pageId - The page id, with or without dashes.
 */
export function notionPageUrl(pageId: string): string {
  return `https://www.notion.so/${pageId.replace(/-/g, '')}`;
}

/**
 * Map one Notion page onto the connector port's provider-agnostic {@link ImportedItem}.
 *
 * @remarks
 * `provenance.externalUpdatedAt` carries the page's `last_edited_time`, which is what the
 * reconciler compares against Docket's own `updatedAt`; `externalListId` carries the data source
 * id so a write-back can address the right database. A page in Notion's trash (`in_trash` /
 * `archived`) becomes a tombstone (`removed: true`) rather than simply vanishing from the pull,
 * so a Notion delete propagates as data instead of as absence.
 *
 * @param page - The raw Notion page object from a data source query.
 * @param schema - The derived schema for that data source.
 * @param importedAt - ISO-8601 timestamp stamped onto the item's provenance.
 * @returns the mapped item, or `undefined` when the payload carries no page id.
 */
export function mapNotionPage(
  page: Readonly<Record<string, unknown>>,
  schema: NotionSchema,
  importedAt: string,
): ImportedItem | undefined {
  const id = str(page, 'id');
  if (id === undefined) return undefined;
  const completed = readNotionCompleted(page, schema);
  const dueDate = readNotionDueDate(page, schema);
  const description = readNotionDescription(page, schema);
  const lastEdited = str(page, 'last_edited_time');
  const removed = page['in_trash'] === true || page['archived'] === true;
  const title = readNotionTitle(page, schema);

  return {
    id,
    kind: 'issue',
    // A Notion page with an empty title is legal; Docket's `task.title` is NOT NULL and blank
    // titles fail a CHECK constraint, so the untitled page keeps Notion's own display wording.
    title: title.length > 0 ? title : 'Untitled',
    ...(description !== undefined && description.length > 0 ? { body: description } : {}),
    ...(completed !== undefined ? { completed } : {}),
    ...(dueDate !== undefined ? { dueDate } : {}),
    ...(removed ? { removed: true } : {}),
    provenance: {
      provider: 'notion',
      externalId: id,
      externalUrl: str(page, 'url') ?? notionPageUrl(id),
      importedAt,
      ...(lastEdited !== undefined ? { externalUpdatedAt: lastEdited } : {}),
      externalListId: schema.dataSourceId,
    },
  };
}

/**
 * Build the `properties` patch body that writes a Docket task's fields onto a Notion page.
 *
 * @remarks
 * This is the outbound half of two-way sync and the mechanism by which Docket supersedes Notion:
 * every field Docket owns is written, and a field the data source cannot express is simply not in
 * the body (never a fabricated property, which Notion would reject with a 400). Clearing is
 * explicit — a null due date writes `{ date: null }`, which is how Notion clears a date.
 *
 * Completion maps back through the status **groups**: the first option in the target group is
 * used, so a workspace whose done column is called "Shipped" gets "Shipped", not a literal "Done"
 * that does not exist in its schema.
 *
 * @param op - The create/update op whose fields should be written.
 * @param schema - The derived schema of the target data source.
 * @returns a Notion `properties` object, empty when the op carries nothing this schema can hold.
 */
export function notionPushProperties(
  op: Extract<TaskPushOp, { kind: 'create' | 'update' }>,
  schema: NotionSchema,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};

  if (op.title !== undefined) {
    properties[schema.titleProperty] = {
      title: [{ type: 'text', text: { content: op.title } }],
    };
  }
  if (op.notes !== undefined && schema.descriptionProperty !== null) {
    properties[schema.descriptionProperty] =
      op.notes === null
        ? { rich_text: [] }
        : { rich_text: [{ type: 'text', text: { content: op.notes } }] };
  }
  if (op.dueDate !== undefined && schema.dueDateProperty !== null) {
    properties[schema.dueDateProperty] =
      op.dueDate === null ? { date: null } : { date: { start: op.dueDate } };
  }
  if (op.completed !== undefined) {
    const completion = completionProperty(schema);
    if (completion.kind === 'checkbox') {
      properties[completion.name] = { checkbox: op.completed };
    } else if (completion.kind === 'status') {
      const target = op.completed
        ? completion.groups.complete[0]
        : (completion.groups.todo[0] ?? completion.groups.inProgress[0]);
      if (target !== undefined) properties[completion.name] = { status: { name: target } };
    }
  }
  return properties;
}
