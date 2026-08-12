/**
 * `@docket/types` — the Notion mirror: Docket-designed databases inside a Notion workspace.
 *
 * @remarks
 * The **inverse** of the linked-database connector in `./integration`. There, a Notion database
 * already exists and Docket derives a mapping from whatever schema it happens to declare. Here,
 * the user designs the database in Docket — names it, names its columns, chooses how each field
 * is represented — and Docket provisions exactly that, then keeps it current.
 *
 * Both modes run on one Notion integration and neither disturbs the other; see
 * `docs/engineering/specs/notion-sync.md`.
 *
 * The load-bearing decision in this file is that a binding addresses a Notion property by its
 * **id**, not its title. Titles are user-chosen on the Docket side and freely renameable on the
 * Notion side; property ids survive a rename and titles do not. Binding by title would let
 * someone rename a column inside Notion and silently sever the sync — which is exactly the class
 * of quiet failure the connector-reliability invariant forbids.
 */
import { z } from 'zod';

/**
 * The Docket entity kinds that can be projected into a Notion database.
 *
 * @remarks
 * `person` is in the list because a People database is one of the four ways a person-valued
 * field can be represented (see {@link NotionPersonRepresentation}) — it is a projection of
 * `actor`, not a separate concept.
 */
export const NotionMirrorEntity = z
  .enum([
    'task',
    'project',
    'initiative',
    'program',
    'team',
    'cycle',
    'milestone',
    'label',
    'person',
  ])
  .meta({
    id: 'NotionMirrorEntity',
    description: 'A Docket entity kind that can be projected into a Notion database.',
  });
/** Notion-mirror entity value. */
export type NotionMirrorEntity = z.infer<typeof NotionMirrorEntity>;

/**
 * Which direction edits flow for an entity.
 *
 * @remarks
 * `two_way` entities accept edits made in Notion and reconcile them Docket-wins; `push` entities
 * are projections only, and an edit made in Notion is drift that gets reverted **and recorded**.
 * Never silently reverted — a revert the user cannot see is indistinguishable from data loss.
 */
export const NotionMirrorDirection = z.enum(['two_way', 'push']).meta({
  id: 'NotionMirrorDirection',
  description: 'Whether a mirrored entity accepts edits from Notion or is projection-only.',
});
/** Notion-mirror direction value. */
export type NotionMirrorDirection = z.infer<typeof NotionMirrorDirection>;

/**
 * The Notion property types Docket can emit when it designs a database.
 *
 * @remarks
 * A deliberate subset of Notion's full property catalog: only types Docket can both write and
 * read back losslessly. Computed types (`formula`, `rollup`) are excluded because Docket has no
 * value to push into them, and `unique_id` because Notion owns its sequence.
 */
export const NotionPropertyKind = z
  .enum([
    'title',
    'rich_text',
    'number',
    'select',
    'multi_select',
    'status',
    'date',
    'checkbox',
    'url',
    'email',
    'people',
    'relation',
  ])
  .meta({
    id: 'NotionPropertyKind',
    description: 'A Notion property type Docket can provision and write.',
  });
/** Notion property-kind value. */
export type NotionPropertyKind = z.infer<typeof NotionPropertyKind>;

/**
 * How a person-valued Docket field (assignee, lead, owner, member) appears in Notion.
 *
 * @remarks
 * There is no single correct answer, which is why this is a per-column choice rather than a
 * product-wide one:
 *
 * - `text` — the person's display name as plain text. The honest default: zero setup, and it
 *   represents **every** human, including those with no Notion account and no Docket account.
 * - `notion_person` — Notion's native `people` property. Unlocks @-mentions, notifications and
 *   "assigned to me", but structurally cannot hold anyone who is not a member of the Notion
 *   workspace, so it is always written **alongside** a `text` or relation representation rather
 *   than instead of one.
 * - `docket_people_table` — a relation to a People database Docket creates and maintains. Every
 *   Docket actor gets a row whether or not they have an account anywhere.
 * - `existing_table` — a relation to a database the workspace already keeps (a team directory,
 *   a volunteer roster). Requires `relationDataSourceId`.
 */
export const NotionPersonRepresentation = z
  .enum(['text', 'notion_person', 'docket_people_table', 'existing_table'])
  .meta({
    id: 'NotionPersonRepresentation',
    description: 'How a person-valued Docket field is represented in a Notion database.',
  });
/** Notion person-representation value. */
export type NotionPersonRepresentation = z.infer<typeof NotionPersonRepresentation>;

/**
 * One designed column: a Docket field bound to a Notion property.
 *
 * @remarks
 * `propertyId` is absent until the database is provisioned and is **the** address used for every
 * subsequent read and write — see the file remarks on why the title is not. `title` is what the
 * user sees, and Docket only writes it at provision time and when the user renames the column in
 * the designer; a rename made on the Notion side is left alone rather than fought over.
 */
export const NotionColumnBinding = z
  .object({
    field: z
      .string()
      .describe(
        'The Docket field key this column carries, e.g. `title`, `assignee`, `dueDate`. Unique within a database.',
      ),
    title: z.string().min(1).describe('The column title shown in Notion. Chosen by the user.'),
    kind: NotionPropertyKind.describe('The Notion property type this column is provisioned as.'),
    order: z
      .number()
      .int()
      .describe(
        "The column's position, left to right. Stored explicitly because `property_map` is jsonb and PostgreSQL does NOT preserve object key order — it normalizes keys by length then bytes, so relying on insertion order silently reorders the columns on the first read back.",
      ),
    propertyId: z
      .string()
      .optional()
      .describe(
        "Notion's own id for the provisioned property. Absent before provisioning. Authoritative for all reads and writes, because it survives a rename on either side.",
      ),
    representation: NotionPersonRepresentation.optional().describe(
      'For person-valued fields only: how the person is rendered. Absent for every other field.',
    ),
    relationDataSourceId: z
      .string()
      .optional()
      .describe(
        'The Notion data source a `relation` column points at. Required when `representation` is `existing_table`; set by Docket when it is `docket_people_table`.',
      ),
  })
  .meta({
    id: 'NotionColumnBinding',
    description: 'A Docket field bound to one Notion property.',
  });
/** Notion column-binding value. */
export type NotionColumnBinding = z.infer<typeof NotionColumnBinding>;

/**
 * Every column of one designed database, keyed by Docket field key.
 *
 * @remarks
 * Keyed by field rather than stored as an array because the push path always starts from a Docket
 * field and needs the binding in constant time. The pull path needs the inverse (Notion property
 * id to Docket field) and builds it once per run rather than persisting a second copy that could
 * drift out of agreement with this one.
 */
export const NotionPropertyMap = z.record(z.string(), NotionColumnBinding).meta({
  id: 'NotionPropertyMap',
  description: 'The columns of a designed Notion database, keyed by Docket field key.',
});
/** Notion property-map value. */
export type NotionPropertyMap = z.infer<typeof NotionPropertyMap>;

/** One designed database, as the API returns it. */
export const NotionMirrorDatabaseOut = z
  .object({
    id: z.string(),
    entityType: NotionMirrorEntity,
    title: z.string().describe('The database title in Notion.'),
    enabled: z.boolean().describe('Whether this entity is projected at all.'),
    direction: NotionMirrorDirection,
    propertyMap: NotionPropertyMap,
    externalDatabaseId: z
      .string()
      .nullable()
      .describe('Null until the database has actually been created in Notion.'),
    externalDataSourceId: z.string().nullable(),
    externalUrl: z.string().nullable(),
    rowCount: z.number().int(),
    provisionedAt: z.string().nullable(),
    lastPushedAt: z.string().nullable(),
    lastPulledAt: z.string().nullable(),
  })
  .meta({
    id: 'NotionMirrorDatabaseOut',
    description: 'One Docket-designed Notion database and its current provisioning state.',
  });
/** Notion-mirror database value. */
export type NotionMirrorDatabaseOut = z.infer<typeof NotionMirrorDatabaseOut>;

/**
 * One preview row rendered in the table designer.
 *
 * @remarks
 * `cells` is keyed by Docket field key and holds already-formatted display strings, not raw
 * values: the designer is showing what Notion will look like, so the server formats once rather
 * than shipping nine entity shapes to the client for it to re-format.
 */
export const NotionMirrorPreviewRow = z
  .object({
    cells: z.record(z.string(), z.string().nullable()),
  })
  .meta({
    id: 'NotionMirrorPreviewRow',
    description: 'One formatted preview row for the table designer.',
  });
/** Notion-mirror preview-row value. */
export type NotionMirrorPreviewRow = z.infer<typeof NotionMirrorPreviewRow>;

/** One Docket field an entity can expose as a column. */
export const NotionMirrorFieldOut = z
  .object({
    field: z.string(),
    label: z.string().describe('The default column title, resolved through the org vocabulary.'),
    kind: NotionPropertyKind,
    personValued: z
      .boolean()
      .describe('Whether this field offers a {@link NotionPersonRepresentation} choice.'),
    required: z
      .boolean()
      .describe('Title fields cannot be removed — Notion requires exactly one per database.'),
  })
  .meta({
    id: 'NotionMirrorFieldOut',
    description: 'A Docket field available as a column in a designed Notion database.',
  });
/** Notion-mirror field value. */
export type NotionMirrorFieldOut = z.infer<typeof NotionMirrorFieldOut>;

/**
 * The designer's view of one entity: the columns, the available fields, and real rows.
 *
 * @remarks
 * `sample` is true when the workspace has no rows of this entity yet and the preview is filled
 * with illustrative data instead. The UI must say so — a designer that shows invented rows
 * without labelling them teaches the user to distrust every number on the page.
 */
export const NotionMirrorDesignOut = z
  .object({
    database: NotionMirrorDatabaseOut,
    availableFields: z
      .array(NotionMirrorFieldOut)
      .describe(
        'Every Docket field this entity can expose, whether or not it is currently a column.',
      ),
    rows: z.array(NotionMirrorPreviewRow),
    sample: z
      .boolean()
      .describe('True when `rows` is illustrative because the workspace has none of this entity.'),
    totalRows: z.number().int().describe('How many rows this database will hold once projected.'),
    excludedRows: z
      .number()
      .int()
      .describe(
        'Rows withheld because they are already linked to another Notion database on this same integration — projecting them would duplicate the same work twice in one workspace.',
      ),
  })
  .meta({
    id: 'NotionMirrorDesignOut',
    description: 'The table designer payload for one entity.',
  });
/** Notion-mirror design value. */
export type NotionMirrorDesignOut = z.infer<typeof NotionMirrorDesignOut>;

/** The designer's save payload for one entity. */
export const NotionMirrorDesignPatch = z
  .object({
    title: z.string().min(1).max(200).optional(),
    enabled: z.boolean().optional(),
    columns: z
      .array(
        NotionColumnBinding.pick({
          field: true,
          title: true,
          representation: true,
          relationDataSourceId: true,
        }),
      )
      .optional()
      .describe(
        'The full column set, in order. A wholesale replace: a field absent here is dropped from the database.',
      ),
  })
  .meta({
    id: 'NotionMirrorDesignPatch',
    description: 'A change to one designed database.',
  });
/** Notion-mirror design-patch value. */
export type NotionMirrorDesignPatch = z.infer<typeof NotionMirrorDesignPatch>;

/**
 * A Notion workspace member offered for matching.
 *
 * @remarks
 * Only `type: 'person'` users from `GET /v1/users` reach this shape. Notion returns integration
 * bots in the same list — a real workspace commonly has several — and offering an automation bot
 * as an assignable teammate would be nonsense.
 */
export const NotionWorkspacePerson = z
  .object({
    externalId: z.string(),
    name: z.string(),
    email: z.string().nullable().describe('Absent for guests Notion does not expose an email for.'),
    avatarUrl: z.string().nullable(),
    actorId: z
      .string()
      .nullable()
      .describe('Null is an explicit unmatched state, never a fallback.'),
    matchedBy: z.enum(['email', 'manual']).nullable(),
  })
  .meta({
    id: 'NotionWorkspacePerson',
    description: 'A Notion workspace member and its current Docket actor match.',
  });
/** Notion workspace-person value. */
export type NotionWorkspacePerson = z.infer<typeof NotionWorkspacePerson>;

/**
 * One Notion page offered as a home for Docket's designed databases.
 *
 * @remarks
 * Everything past `id` and `title` exists to tell two same-named pages apart. A workspace of any
 * age has several pages called "Projects", and the picker cannot resolve each result's parent
 * *title* — that is one extra Notion request per row, per keystroke. So it shows what a single
 * search result already carries: the page's own emoji, whether it sits at the top level, and when
 * it was last edited.
 *
 * All three are optional because `pages.retrieve` and `search` are allowed to omit them, and a
 * missing icon must degrade to a plain row rather than to an error.
 */
export const NotionParentPageOut = z
  .object({
    id: z.string(),
    title: z.string().describe("The page's title, or `Untitled` when it has none."),
    url: z.string().nullable().describe('A deep link to the page in Notion.'),
    icon: z
      .string()
      .nullable()
      .describe('The page emoji. Image icons are deliberately not carried — see the client.'),
    lastEditedTime: z
      .string()
      .nullable()
      .describe('ISO-8601. Also the field the search results are ordered by.'),
    parentKind: z
      .enum(['workspace', 'page', 'database'])
      .nullable()
      .describe('Where the page sits, as far as one search result can say.'),
  })
  .meta({
    id: 'NotionParentPageOut',
    description: 'A Notion page Docket may build its designed databases under.',
  });
/** Notion parent-page value. */
export type NotionParentPageOut = z.infer<typeof NotionParentPageOut>;

/** The decision a person makes about one unmatched Notion member. */
export const NotionPersonResolve = z
  .object({
    action: z
      .enum(['create_actor', 'match_existing', 'skip'])
      .describe(
        '`create_actor` adds them to Docket as a person with no account; `match_existing` links them to an actor you name; `skip` leaves them unmatched on purpose.',
      ),
    actorId: z
      .string()
      .optional()
      .describe('Required for `match_existing` — the Docket actor to link them to.'),
  })
  .meta({
    id: 'NotionPersonResolve',
    description: 'Resolve one unmatched Notion workspace member.',
  });
/** Notion person-resolve value. */
export type NotionPersonResolve = z.infer<typeof NotionPersonResolve>;

/** What to do with an unmatched Notion person. */
export const NotionPersonResolution = z
  .enum(['create_actor', 'match_existing', 'invite', 'skip'])
  .meta({
    id: 'NotionPersonResolution',
    description: 'The chosen disposition for one unmatched Notion workspace member.',
  });
/** Notion person-resolution value. */
export type NotionPersonResolution = z.infer<typeof NotionPersonResolution>;
