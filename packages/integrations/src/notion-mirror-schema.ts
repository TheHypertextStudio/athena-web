/**
 * `@docket/integrations` — the Notion mirror's field catalog. Pure; no HTTP, no database.
 *
 * @remarks
 * Declares, for each Docket entity kind, which fields can become columns in a Docket-designed
 * Notion database, what Notion property type each becomes, and which of them accept an edit made
 * on the Notion side. The table designer renders this, and the sync engine reads the same
 * catalog — so a field the designer offers is by construction a field the sync can carry, and
 * there is no second list to fall out of agreement with the first.
 *
 * Everything here is data. The only functions are resolvers that fold an org's vocabulary skin
 * into default titles, which is why this module can live in a package that depends on nothing
 * but `@docket/types`.
 *
 * @see `docs/engineering/specs/notion-sync.md`
 */
import {
  type NotionColumnBinding,
  type NotionMirrorDirection,
  type NotionMirrorEntity,
  type NotionPropertyKind,
  type NotionPropertyMap,
  type VocabularyKey,
  type VocabularySkin,
  resolveVocabularyTerm,
} from '@docket/types';

/** One Docket field that can become a column in a designed Notion database. */
export interface MirrorField {
  /** The Docket field key. Unique within its entity, and the key of the property map. */
  readonly field: string;
  /** The default column title when the entity has no vocabulary term to derive one from. */
  readonly label: string;
  /** The Notion property type this field is provisioned as. */
  readonly kind: NotionPropertyKind;
  /**
   * Whether this field offers a person-representation choice in the designer.
   *
   * @remarks
   * True for every field whose value is a Docket actor. {@link MirrorField.kind} records the
   * *default* shape (`rich_text`, i.e. plain text); choosing another representation changes the
   * provisioned type to `people` or `relation`. Plain text is the default because it is the only
   * representation that can hold every human — including the ones with no Notion account.
   */
  readonly personValued?: boolean;
  /**
   * The person-valued field this column is the native-Notion companion of.
   *
   * @remarks
   * Present only on **derived** columns, which the designer never offers directly: they are
   * generated from their parent's representation and regenerated on every save.
   *
   * They exist because Notion's `people` property structurally cannot hold anyone outside the
   * workspace. Provisioning it *instead of* the parent — which is what choosing "Notion person"
   * used to do — deletes the only column that can hold a person with no Notion account, i.e. the
   * exact population the representation choice exists to protect. So it is provisioned *beside*
   * the parent, never in place of it.
   *
   * @see `docs/engineering/specs/notion-sync.md` §8.3
   */
  readonly personCompanionOf?: string;
  /** Notion requires exactly one title property, so that column can never be removed. */
  readonly required?: boolean;
  /** The entity a `relation` column points at. */
  readonly relationEntity?: NotionMirrorEntity;
  /**
   * Whether an edit made in Notion is carried back to Docket.
   *
   * @remarks
   * Only meaningful on a `two_way` entity; on a `push` entity every field is projection-only and
   * an edit is drift. Absent means read-only even on a two-way entity — `url` is the clear case,
   * since it is a link back into Docket that Notion has no business redefining.
   */
  readonly writable?: boolean;
}

/** Everything the designer and the sync engine need to know about one projected entity. */
export interface MirrorEntitySpec {
  readonly entity: NotionMirrorEntity;
  /** Whether edits made in Notion flow back, or are drift to be reverted and recorded. */
  readonly direction: NotionMirrorDirection;
  /** The vocabulary key whose term titles the database, when the entity has one. */
  readonly vocabularyKey?: VocabularyKey;
  /** The database title when no vocabulary term applies. */
  readonly defaultTitle: string;
  /** Every field this entity can expose, in designer order. */
  readonly fields: readonly MirrorField[];
  /** The fields that are columns out of the box, in column order. */
  readonly defaultColumns: readonly string[];
}

/**
 * Why states and statuses are `select` rather than Notion's `status` type.
 *
 * @remarks
 * Notion's `status` property carries a fixed three-group structure (`to_do` / `in_progress` /
 * `complete`) that must be declared when the schema is created. Docket's `task.state` is
 * deliberately not an enum at all — it is per-team free text resolved against the team's own
 * `workflow_states`, so a single org can hold states no fixed grouping describes. A `select`
 * renders as the same coloured chip in Notion and accepts whatever option set the org actually
 * uses; the option list is derived from live data at provision time rather than hardcoded here.
 * Board grouping by `status` group is the thing given up, and it is worth revisiting once
 * per-team databases exist.
 */
const STATE_KIND: NotionPropertyKind = 'select';

/** A link back to the record in Docket. Present on every entity, never writable from Notion. */
const DOCKET_URL_FIELD: MirrorField = {
  field: 'docketUrl',
  label: 'Open in Docket',
  kind: 'url',
};

/** Per-entity field catalogs. */
const AUTHORED_ENTITY_SPECS: Record<NotionMirrorEntity, MirrorEntitySpec> = {
  task: {
    entity: 'task',
    direction: 'two_way',
    vocabularyKey: 'task',
    defaultTitle: 'Tasks',
    fields: [
      { field: 'title', label: 'Name', kind: 'title', required: true, writable: true },
      { field: 'state', label: 'Status', kind: STATE_KIND, writable: true },
      {
        field: 'assignee',
        label: 'Assignee',
        kind: 'rich_text',
        personValued: true,
        writable: true,
      },
      { field: 'dueDate', label: 'Due', kind: 'date', writable: true },
      { field: 'startDate', label: 'Start', kind: 'date', writable: true },
      { field: 'priority', label: 'Priority', kind: 'select', writable: true },
      { field: 'estimateMinutes', label: 'Estimate (minutes)', kind: 'number', writable: true },
      { field: 'description', label: 'Description', kind: 'rich_text', writable: true },
      {
        field: 'project',
        label: 'Project',
        kind: 'relation',
        relationEntity: 'project',
        writable: true,
      },
      { field: 'cycle', label: 'Cycle', kind: 'relation', relationEntity: 'cycle' },
      { field: 'milestone', label: 'Milestone', kind: 'relation', relationEntity: 'milestone' },
      { field: 'team', label: 'Team', kind: 'relation', relationEntity: 'team' },
      { field: 'labels', label: 'Labels', kind: 'relation', relationEntity: 'label' },
      DOCKET_URL_FIELD,
    ],
    defaultColumns: ['title', 'state', 'assignee', 'dueDate', 'project', 'priority'],
  },

  project: {
    entity: 'project',
    direction: 'two_way',
    vocabularyKey: 'project',
    defaultTitle: 'Projects',
    fields: [
      { field: 'name', label: 'Name', kind: 'title', required: true, writable: true },
      { field: 'status', label: 'Status', kind: STATE_KIND, writable: true },
      { field: 'health', label: 'Health', kind: 'select', writable: true },
      { field: 'lead', label: 'Lead', kind: 'rich_text', personValued: true, writable: true },
      { field: 'targetDate', label: 'Target date', kind: 'date', writable: true },
      { field: 'startDate', label: 'Start date', kind: 'date', writable: true },
      { field: 'summary', label: 'Summary', kind: 'rich_text', writable: true },
      { field: 'program', label: 'Program', kind: 'relation', relationEntity: 'program' },
      { field: 'team', label: 'Team', kind: 'relation', relationEntity: 'team' },
      {
        field: 'initiatives',
        label: 'Initiatives',
        kind: 'relation',
        relationEntity: 'initiative',
      },
      DOCKET_URL_FIELD,
    ],
    defaultColumns: ['name', 'status', 'health', 'lead', 'targetDate', 'program'],
  },

  initiative: {
    entity: 'initiative',
    direction: 'push',
    vocabularyKey: 'initiative',
    defaultTitle: 'Initiatives',
    fields: [
      { field: 'name', label: 'Name', kind: 'title', required: true },
      { field: 'status', label: 'Status', kind: STATE_KIND },
      { field: 'health', label: 'Health', kind: 'select' },
      { field: 'priority', label: 'Priority', kind: 'select' },
      { field: 'owner', label: 'Owner', kind: 'rich_text', personValued: true },
      { field: 'targetDate', label: 'Target date', kind: 'date' },
      { field: 'updateCadence', label: 'Update cadence', kind: 'select' },
      { field: 'summary', label: 'Summary', kind: 'rich_text' },
      { field: 'projects', label: 'Projects', kind: 'relation', relationEntity: 'project' },
      { field: 'programs', label: 'Programs', kind: 'relation', relationEntity: 'program' },
      DOCKET_URL_FIELD,
    ],
    defaultColumns: ['name', 'status', 'health', 'owner', 'targetDate'],
  },

  program: {
    entity: 'program',
    direction: 'push',
    vocabularyKey: 'program',
    defaultTitle: 'Programs',
    fields: [
      { field: 'name', label: 'Name', kind: 'title', required: true },
      { field: 'status', label: 'Status', kind: STATE_KIND },
      { field: 'health', label: 'Health', kind: 'select' },
      { field: 'owner', label: 'Owner', kind: 'rich_text', personValued: true },
      { field: 'summary', label: 'Summary', kind: 'rich_text' },
      { field: 'projects', label: 'Projects', kind: 'relation', relationEntity: 'project' },
      DOCKET_URL_FIELD,
    ],
    defaultColumns: ['name', 'status', 'health', 'owner'],
  },

  team: {
    entity: 'team',
    direction: 'push',
    vocabularyKey: 'team',
    defaultTitle: 'Teams',
    fields: [
      { field: 'name', label: 'Name', kind: 'title', required: true },
      { field: 'key', label: 'Key', kind: 'rich_text' },
      { field: 'summary', label: 'Summary', kind: 'rich_text' },
      { field: 'members', label: 'Members', kind: 'relation', relationEntity: 'person' },
      DOCKET_URL_FIELD,
    ],
    defaultColumns: ['name', 'key', 'members'],
  },

  cycle: {
    entity: 'cycle',
    direction: 'push',
    vocabularyKey: 'cycle',
    defaultTitle: 'Cycles',
    fields: [
      { field: 'name', label: 'Name', kind: 'title', required: true },
      { field: 'number', label: 'Number', kind: 'number' },
      { field: 'status', label: 'Status', kind: STATE_KIND },
      { field: 'startsAt', label: 'Starts', kind: 'date' },
      { field: 'endsAt', label: 'Ends', kind: 'date' },
      { field: 'team', label: 'Team', kind: 'relation', relationEntity: 'team' },
      DOCKET_URL_FIELD,
    ],
    defaultColumns: ['name', 'number', 'status', 'startsAt', 'endsAt', 'team'],
  },

  milestone: {
    entity: 'milestone',
    direction: 'push',
    defaultTitle: 'Milestones',
    fields: [
      { field: 'name', label: 'Name', kind: 'title', required: true },
      { field: 'targetDate', label: 'Target date', kind: 'date' },
      { field: 'description', label: 'Description', kind: 'rich_text' },
      { field: 'project', label: 'Project', kind: 'relation', relationEntity: 'project' },
      DOCKET_URL_FIELD,
    ],
    defaultColumns: ['name', 'targetDate', 'project'],
  },

  label: {
    entity: 'label',
    direction: 'push',
    defaultTitle: 'Labels',
    fields: [
      { field: 'name', label: 'Name', kind: 'title', required: true },
      { field: 'color', label: 'Color', kind: 'select' },
      { field: 'group', label: 'Group', kind: 'select' },
    ],
    defaultColumns: ['name', 'color', 'group'],
  },

  person: {
    entity: 'person',
    direction: 'push',
    defaultTitle: 'People',
    fields: [
      { field: 'displayName', label: 'Name', kind: 'title', required: true },
      { field: 'email', label: 'Email', kind: 'email' },
      { field: 'jobTitle', label: 'Title', kind: 'rich_text' },
      /**
       * The native Notion person, populated only where a match exists.
       *
       * @remarks
       * Deliberately a separate column from `displayName` rather than a representation choice on
       * it: a People database's title must hold *every* actor, and Notion's `people` property
       * structurally cannot. Keeping both means the roster is complete and the matched subset
       * still gets @-mentions and notifications.
       */
      { field: 'notionUser', label: 'Notion account', kind: 'people' },
      {
        field: 'hasDocketAccount',
        label: 'Has a Docket account',
        kind: 'checkbox',
      },
      { field: 'teams', label: 'Teams', kind: 'relation', relationEntity: 'team' },
    ],
    defaultColumns: ['displayName', 'email', 'jobTitle', 'notionUser', 'hasDocketAccount'],
  },
};

/** The field key of the native-Notion companion column for a person-valued field. */
export function personCompanionKey(parentField: string): string {
  return `${parentField}NotionPerson`;
}

/**
 * Derive the native-Notion companion for each of an entity's person-valued fields.
 *
 * @remarks
 * Generated rather than hand-written so a companion cannot go missing from a person-valued field
 * somebody adds later, and so its shape cannot drift from its parent's. Emitted immediately after
 * its parent, so every consumer that walks `fields` in order — the designer's palette, the
 * provisioner's column specs — sees the pair adjacent without having to know they are related.
 *
 * @param spec - The authored catalog entry.
 * @returns the same entry with its companion columns woven in.
 */
function withPersonCompanions(spec: MirrorEntitySpec): MirrorEntitySpec {
  return {
    ...spec,
    fields: spec.fields.flatMap((field) =>
      field.personValued === true
        ? [
            field,
            {
              field: personCompanionKey(field.field),
              label: `${field.label} (Notion)`,
              kind: 'people' as const,
              personCompanionOf: field.field,
            },
          ]
        : [field],
    ),
  };
}

/**
 * Everything the designer and the sync engine need to know about every projected entity.
 *
 * @remarks
 * The authored catalog plus the derived companion columns. Companions are deliberately absent from
 * every `defaultColumns` list: a companion exists only because somebody chose the representation
 * that needs it.
 */
export const MIRROR_ENTITY_SPECS: Record<NotionMirrorEntity, MirrorEntitySpec> = Object.fromEntries(
  Object.entries(AUTHORED_ENTITY_SPECS).map(([entity, spec]) => [
    entity,
    withPersonCompanions(spec),
  ]),
) as Record<NotionMirrorEntity, MirrorEntitySpec>;

/** Every entity kind, in the order the designer lists them. */
export const MIRROR_ENTITY_ORDER: readonly NotionMirrorEntity[] = [
  'task',
  'project',
  'initiative',
  'program',
  'team',
  'cycle',
  'milestone',
  'label',
  'person',
];

/**
 * The order entities are **projected** in.
 *
 * @remarks
 * Load-bearing rather than cosmetic: a relation can only carry a page id that already exists, so
 * an entity has to be written before anything that points at it.
 *
 * **No order satisfies every relation, because the catalog has cycles** — `person`↔`team`,
 * `project`↔`program` and `project`↔`initiative` each reference the other. Three edges must
 * therefore be deferred to a second pass no matter what, and this order chooses *which* three:
 * `person.teams`, `program.projects` and `project.initiatives`, none of which is a default column.
 * Every relation a workspace gets out of the box resolves on the first pass.
 *
 * That is a judgment about which columns people actually have, which is why the order is written
 * down rather than derived by a topological sort — a sort cannot know that `team.members` is a
 * default column and `person.teams` is not, and would break the cycle arbitrarily. The choice is
 * pinned by a test that recomputes the deferred edges from the catalog, so adding a relation field
 * that changes them fails loudly instead of quietly costing a pass.
 *
 * `person` stays first, as the person-representation work established.
 *
 * Distinct from {@link MIRROR_ENTITY_ORDER}, which is the order the *designer* lists entities in
 * and deliberately puts `person` last: the roster is the least interesting table to configure and
 * the most important one to write.
 *
 * @see {@link deferredRelationEdges}
 */
export const MIRROR_PROJECTION_ORDER: readonly NotionMirrorEntity[] = [
  'person',
  'team',
  'label',
  'program',
  'project',
  'initiative',
  'milestone',
  'cycle',
  'task',
];

/** One entity's relation column, and the entity it points at. */
export interface MirrorRelationEdge {
  readonly from: NotionMirrorEntity;
  readonly field: string;
  readonly to: NotionMirrorEntity;
}

/**
 * Every relation the catalog declares, as edges from the referring entity to its target.
 *
 * @remarks
 * Person-valued fields are included: they become relations to the People database whenever
 * somebody picks that representation, so they constrain the projection order exactly as a catalog
 * relation does. Derived companion columns are not — a native Notion person property references
 * workspace members, not a Docket database, so it depends on no projection.
 *
 * @returns one edge per relation column, in catalog order.
 */
export function relationEdges(): MirrorRelationEdge[] {
  const edges: MirrorRelationEdge[] = [];
  for (const entity of MIRROR_ENTITY_ORDER) {
    for (const field of MIRROR_ENTITY_SPECS[entity].fields) {
      if (field.personCompanionOf !== undefined) continue;
      const to = field.personValued === true ? 'person' : field.relationEntity;
      if (to === undefined) continue;
      edges.push({ from: entity, field: field.field, to });
    }
  }
  return edges;
}

/**
 * The relations {@link MIRROR_PROJECTION_ORDER} cannot satisfy in one pass.
 *
 * @remarks
 * An edge is deferred when its target is projected *after* the entity referring to it, which for a
 * cyclic graph is unavoidable for at least one edge per cycle. Computed from the catalog rather
 * than listed, so the answer stays true as fields are added.
 *
 * A self-edge (an entity relating to its own kind) is not deferred: by the time a row is written,
 * earlier rows of the same entity already have pages, and the rest converge on the next pass the
 * same way any other back edge does.
 *
 * @returns every edge whose target has not been projected by the time it is needed.
 */
export function deferredRelationEdges(): MirrorRelationEdge[] {
  const position = new Map(MIRROR_PROJECTION_ORDER.map((entity, index) => [entity, index]));
  return relationEdges().filter((edge) => {
    const from = position.get(edge.from);
    const to = position.get(edge.to);
    // An entity missing from the order is the misconfiguration this function exists to catch, so
    // it counts as deferred rather than defaulting to position 0. Defaulting hid it twice over:
    // the edge looked satisfied here, while `runNotionMirrorSync`'s `indexOf` sort read the same
    // entity as -1 and projected it first — the two disagreeing with nothing to say so.
    if (from === undefined || to === undefined) return true;
    return to > from;
  });
}

/**
 * The database title an entity gets before the user renames it.
 *
 * @param entity - The entity kind.
 * @param skin - The org's vocabulary skin, or null for the neutral default.
 * @returns the org's own plural term for the entity (e.g. "Campaigns" for a nonprofit skin).
 */
export function defaultDatabaseTitle(
  entity: NotionMirrorEntity,
  skin: VocabularySkin | null | undefined,
): string {
  const spec = MIRROR_ENTITY_SPECS[entity];
  if (spec.vocabularyKey === undefined) return spec.defaultTitle;
  return resolveVocabularyTerm(skin, spec.vocabularyKey).plural;
}

/**
 * The column title a field gets before the user renames it.
 *
 * @remarks
 * Relation columns are titled with the org's own term for the entity they point at, so a
 * nonprofit workspace sees "Campaigns" rather than "Initiatives" without configuring anything.
 * Every other field keeps its static label.
 *
 * @param entity - The entity the column belongs to.
 * @param field - The field key.
 * @param skin - The org's vocabulary skin.
 * @returns the default column title, or undefined when the field is not in the catalog.
 */
export function defaultColumnTitle(
  entity: NotionMirrorEntity,
  field: string,
  skin: VocabularySkin | null | undefined,
): string | undefined {
  const spec = MIRROR_ENTITY_SPECS[entity].fields.find((f) => f.field === field);
  if (spec === undefined) return undefined;
  const target = spec.relationEntity;
  if (target !== undefined) {
    const targetKey = MIRROR_ENTITY_SPECS[target].vocabularyKey;
    if (targetKey !== undefined) {
      const term = resolveVocabularyTerm(skin, targetKey);
      // A to-many relation reads plural ("Projects"), a to-one reads singular ("Project").
      return spec.label.endsWith('s') ? term.plural : term.singular;
    }
  }
  return spec.label;
}

/**
 * Build the property map an entity starts with, before the user touches the designer.
 *
 * @param entity - The entity kind.
 * @param skin - The org's vocabulary skin.
 * @returns the default columns, keyed by field, with no `propertyId` yet (nothing is provisioned).
 */
export function defaultPropertyMap(
  entity: NotionMirrorEntity,
  skin: VocabularySkin | null | undefined,
): NotionPropertyMap {
  const spec = MIRROR_ENTITY_SPECS[entity];
  const map: Record<string, NotionColumnBinding> = {};
  let order = 0;
  for (const field of spec.defaultColumns) {
    const def = spec.fields.find((f) => f.field === field);
    if (def === undefined) continue;
    map[field] = {
      field,
      title: defaultColumnTitle(entity, field, skin) ?? def.label,
      kind: def.kind,
      order: order++,
      // Person-valued fields default to plain text: the only representation that can hold a
      // human with no Notion account, which is most of them in most workspaces.
      ...(def.personValued === true ? { representation: 'text' as const } : {}),
    };
  }
  return map;
}

/**
 * Look up one field's catalog entry.
 *
 * @param entity - The entity kind.
 * @param field - The field key.
 * @returns the catalog entry, or undefined for a field this entity does not expose.
 */
export function mirrorField(entity: NotionMirrorEntity, field: string): MirrorField | undefined {
  return MIRROR_ENTITY_SPECS[entity].fields.find((f) => f.field === field);
}

/**
 * The fields whose Notion edits are carried back into Docket.
 *
 * @remarks
 * Empty for a `push` entity by construction, so a caller never has to special-case direction:
 * asking a push-only entity what it accepts correctly yields nothing.
 *
 * @param entity - The entity kind.
 * @returns the writable field keys.
 */
export function writableFields(entity: NotionMirrorEntity): readonly string[] {
  const spec = MIRROR_ENTITY_SPECS[entity];
  if (spec.direction !== 'two_way') return [];
  return spec.fields.filter((f) => f.writable === true).map((f) => f.field);
}

/**
 * The designed columns in their left-to-right order.
 *
 * @remarks
 * `property_map` is jsonb, and PostgreSQL does not preserve object key order — it normalizes keys
 * by length then bytes. So insertion order is lost on the first read back, and every consumer must
 * sort by the explicit `order` instead of trusting `Object.values`.
 *
 * @param map - The property map.
 * @returns the bindings, ordered.
 */
export function orderedColumns(map: NotionPropertyMap): NotionColumnBinding[] {
  return Object.values(map).sort((a, b) => a.order - b.order);
}

/**
 * Invert a property map into Notion-property-id → Docket-field-key.
 *
 * @param map - The forward property map.
 * @returns a map from Notion property id to Docket field key.
 */
export function fieldsByPropertyId(map: NotionPropertyMap): Map<string, string> {
  const byId = new Map<string, string>();
  for (const binding of Object.values(map)) {
    if (binding.propertyId === undefined) continue;
    byId.set(binding.propertyId, binding.field);
  }
  return byId;
}

/**
 * The Notion property type a binding is actually provisioned as.
 *
 * @remarks
 * A person-valued field's type depends on the representation the user chose, so the catalog's
 * `kind` is only the default. Resolving it in one place keeps provisioning, schema updates and
 * value mapping from each deriving it slightly differently.
 *
 * `notion_person` maps to `rich_text`, **not** `people`, and that is the correction that makes the
 * representation safe. Notion's people property can only reference members of the Notion
 * workspace, so provisioning it in place of the text column would delete the only column able to
 * hold a person with no Notion account — the population the choice exists to protect. The native
 * property is added *beside* it as a derived companion column, which carries `kind: 'people'` in
 * the catalog and therefore reaches the `default` branch below.
 *
 * A `people` property is consequently never the product of a *representation*; it is always a
 * column of its own.
 *
 * @param binding - The designed column.
 * @returns the Notion property type to create.
 * @see `docs/engineering/specs/notion-sync.md` §8.3
 */
export function provisionedKind(binding: NotionColumnBinding): NotionPropertyKind {
  switch (binding.representation) {
    case 'notion_person':
    case 'text':
      return 'rich_text';
    case 'docket_people_table':
    case 'existing_table':
      return 'relation';
    default:
      return binding.kind;
  }
}
