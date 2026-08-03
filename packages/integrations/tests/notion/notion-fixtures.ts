/**
 * Notion API payload fixtures for the REAL "Las Vegans for Better Transit" workspace, plus one
 * deliberately synthetic second schema (see the `MY_TASKS_*` remark below).
 *
 * @remarks
 * `TASKS_TRACKER_PROPERTIES` was read out of the live workspace through the Notion MCP surface —
 * re-verified again on 2026-08-02 against `collection://383c7791-208f-802e-9508-000b6d244e57` and
 * matching byte for byte (property names, ids, the `status` groups, the `Project` relation
 * target). It is transcribed rather than invented so a mapping bug cannot hide behind a
 * convenient fake.
 *
 * **`MY_TASKS_PROPERTIES` is NOT a live-verified schema — this was re-checked on 2026-08-02 and
 * found to be wrong.** The LVBT workspace's sidebar "My Tasks" (id `6f60a403-…`) is not a
 * standalone data source at all: it is Notion's built-in cross-database "assigned to me" home
 * view. Live evidence, gathered through the same connected Notion MCP this fixture file claims to
 * be transcribed from:
 *   - Fetching the "My Tasks" database by id returns no `<data-sources>` block (unlike
 *     `Tasks Tracker`, whose database fetch lists its data source explicitly), and its one view's
 *     `dataSourceUrl` is the empty string.
 *   - `GET /v1/data_sources/6f60a403-0e08-47a3-8948-9fa25cdf97be` (`collection://` fetch) 404s:
 *     `"Could not find data_source with ID: …"` — the same call `NotionProviderClient.schemaFor`
 *     makes, so the real connector would hit this too, not a mapping gap.
 *   - Querying the "My Tasks" view returns real pages whose own `<parent-data-source>` is
 *     `collection://383c7791-208f-802e-9508-000b6d244e57` — i.e. `Tasks Tracker` itself. "My
 *     Tasks" has no rows of its own; it is a filtered lens over rows that already live in a real,
 *     already-syncable database.
 *
 * So `MY_TASKS_PROPERTIES` is kept here only as a **synthetic stand-in for a differently-named
 * custom database** — it still earns its keep by proving `readNotionSchema` resolves properties by
 * type + name preference ("Due", not "Due date") rather than by a hard-coded property name, and
 * that it reports an unmapped `rollup` property instead of dropping it. It must not be cited as
 * evidence of what Notion's public API actually returns for a native task view, because (per the
 * above) there is no such queryable object for a public integration to ever see. See
 * `docs/engineering/specs/notion-sync.md` §3 for the write-up this finding fed back into.
 */

/** The real data source id of the LVBT "Tasks Tracker" database. */
export const TASKS_TRACKER_DATA_SOURCE = '383c7791-208f-802e-9508-000b6d244e57';

/**
 * A synthetic data source id standing in for a differently-named custom database.
 *
 * @remarks
 * Reuses the id of the LVBT workspace's native "My Tasks" home view for continuity with earlier
 * fixtures, but — per the file remark above — that id resolves to no queryable data source at all;
 * treat this purely as an arbitrary second id, not as a real database's identity.
 */
export const MY_TASKS_DATA_SOURCE = '6f60a403-0e08-47a3-8948-9fa25cdf97be';

/**
 * The `properties` map of the LVBT "Tasks Tracker" data source, in Notion REST shape.
 *
 * @remarks
 * The REST API returns status groups as `groups: [{ name, option_ids }]` alongside a flat
 * `options: [{ id, name }]` list, which is why the option names have to be resolved through the
 * ids rather than read directly off the group.
 */
export const TASKS_TRACKER_PROPERTIES: Readonly<Record<string, unknown>> = {
  'Task name': { id: 'title', name: 'Task name', type: 'title', title: {} },
  Status: {
    id: 'b2Jvcw',
    name: 'Status',
    type: 'status',
    status: {
      options: [
        { id: 'opt-not-started', name: 'Not started', color: 'default' },
        { id: 'opt-in-progress', name: 'In progress', color: 'blue' },
        { id: 'opt-done', name: 'Done', color: 'green' },
      ],
      groups: [
        { id: 'grp-todo', name: 'To-do', color: 'gray', option_ids: ['opt-not-started'] },
        { id: 'grp-doing', name: 'In progress', color: 'blue', option_ids: ['opt-in-progress'] },
        { id: 'grp-done', name: 'Complete', color: 'green', option_ids: ['opt-done'] },
      ],
    },
  },
  Assignee: { id: 'QUNz', name: 'Assignee', type: 'people', people: {} },
  'Due date': { id: 'RHVl', name: 'Due date', type: 'date', date: {} },
  Priority: {
    id: 'UEZ1dg',
    name: 'Priority',
    type: 'select',
    select: {
      options: [
        { id: 'p-high', name: 'High', color: 'red' },
        { id: 'p-med', name: 'Medium', color: 'yellow' },
        { id: 'p-low', name: 'Low', color: 'green' },
      ],
    },
  },
  Description: { id: 'RGVz', name: 'Description', type: 'rich_text', rich_text: {} },
  'Effort level': {
    id: 'QUN3Xw',
    name: 'Effort level',
    type: 'select',
    select: {
      options: [
        { id: 'e-small', name: 'Small', color: 'green' },
        { id: 'e-med', name: 'Medium', color: 'yellow' },
        { id: 'e-large', name: 'Large', color: 'red' },
      ],
    },
  },
  Project: {
    id: 'bFBbUw',
    name: 'Project',
    type: 'relation',
    relation: { data_source_id: '380c7791-208f-803e-bbe5-000b78285c4f' },
  },
  'Parent Task': {
    id: 'fkV5PA',
    name: 'Parent Task',
    type: 'relation',
    relation: { data_source_id: TASKS_TRACKER_DATA_SOURCE },
  },
  Subtasks: {
    id: 'OmtPZg',
    name: 'Subtasks',
    type: 'relation',
    relation: { data_source_id: TASKS_TRACKER_DATA_SOURCE },
  },
  'Updated at': { id: 'VXBk', name: 'Updated at', type: 'last_edited_time', last_edited_time: {} },
};

/**
 * A synthetic `properties` map for a differently-named custom database (NOT Notion's native "My
 * Tasks" home view — see the file-level remark above for why that view has no schema of its own).
 *
 * @remarks
 * Deliberately names its date property "Due" (not "Due date") and carries a read-only `Source`
 * property that has no Docket destination, so the derived mapping has to resolve by TYPE with a
 * name preference, and has to report `Source` as unmapped rather than silently ignoring it.
 */
export const MY_TASKS_PROPERTIES: Readonly<Record<string, unknown>> = {
  'Task name': { id: 'title', name: 'Task name', type: 'title', title: {} },
  Status: {
    id: 'stat',
    name: 'Status',
    type: 'status',
    status: {
      options: [
        { id: 'mt-todo', name: 'To-do', color: 'default' },
        { id: 'mt-doing', name: 'Doing', color: 'blue' },
        { id: 'mt-done', name: 'Done', color: 'green' },
      ],
      groups: [
        { id: 'mt-g1', name: 'To-do', color: 'gray', option_ids: ['mt-todo'] },
        { id: 'mt-g2', name: 'In progress', color: 'blue', option_ids: ['mt-doing'] },
        { id: 'mt-g3', name: 'Complete', color: 'green', option_ids: ['mt-done'] },
      ],
    },
  },
  Due: { id: 'due', name: 'Due', type: 'date', date: {} },
  Assignee: { id: 'asg', name: 'Assignee', type: 'people', people: {} },
  Source: { id: 'src', name: 'Source', type: 'rollup', rollup: {} },
};

/** Options for {@link tasksTrackerPage}. */
export interface PageOverrides {
  /** Page id. */
  readonly id?: string;
  /** `Task name` title text. */
  readonly title?: string;
  /** `Status` option name (omit for an unset status). */
  readonly status?: string | null;
  /** `Due date` start value (omit for an unset date). */
  readonly due?: string | null;
  /** `Description` rich-text content. */
  readonly description?: string;
  /** `Priority` option name. */
  readonly priority?: string;
  /** `Assignee` Notion user ids. */
  readonly assignees?: readonly string[];
  /** `last_edited_time`. */
  readonly lastEditedTime?: string;
  /** Whether the page sits in Notion's trash. */
  readonly inTrash?: boolean;
}

/** Build a page object shaped exactly as a `Tasks Tracker` data-source query returns one. */
export function tasksTrackerPage(over: PageOverrides = {}): Record<string, unknown> {
  const id = over.id ?? '386c7791-208f-80e6-a74e-da40db98177e';
  return {
    object: 'page',
    id,
    created_time: '2026-06-21T23:13:00.000Z',
    last_edited_time: over.lastEditedTime ?? '2026-07-14T21:57:00.000Z',
    in_trash: over.inTrash ?? false,
    url: `https://www.notion.so/${id.replace(/-/g, '')}`,
    parent: { type: 'data_source_id', data_source_id: TASKS_TRACKER_DATA_SOURCE },
    properties: {
      'Task name': {
        id: 'title',
        type: 'title',
        title:
          over.title === undefined
            ? [{ type: 'text', plain_text: 'Submit Form 1023-EZ for 501(c)(3) application' }]
            : over.title === ''
              ? []
              : [{ type: 'text', plain_text: over.title }],
      },
      Status: {
        id: 'b2Jvcw',
        type: 'status',
        status:
          over.status === null
            ? null
            : { id: 'opt', name: over.status ?? 'Not started', color: 'default' },
      },
      'Due date': {
        id: 'RHVl',
        type: 'date',
        date: over.due === null || over.due === undefined ? null : { start: over.due, end: null },
      },
      Description: {
        id: 'RGVz',
        type: 'rich_text',
        rich_text:
          over.description === undefined ? [] : [{ type: 'text', plain_text: over.description }],
      },
      Priority: {
        id: 'UEZ1dg',
        type: 'select',
        select: over.priority === undefined ? null : { id: 'p', name: over.priority },
      },
      Assignee: {
        id: 'QUNz',
        type: 'people',
        people: (over.assignees ?? []).map((personId) => ({ object: 'user', id: personId })),
      },
      'Updated at': {
        id: 'VXBk',
        type: 'last_edited_time',
        last_edited_time: over.lastEditedTime ?? '2026-07-14T21:57:00.000Z',
      },
    },
  };
}
