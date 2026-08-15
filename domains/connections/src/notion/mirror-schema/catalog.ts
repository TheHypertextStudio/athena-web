/**
 * The pure field catalog for Docket-designed Notion databases.
 *
 * The catalog is intentionally separate from the provider adapter: it is used by both the
 * designer and the synchronizer, neither of which should need Notion SDK code to answer what a
 * field means.
 */
import type {
  NotionMirrorDirection,
  NotionMirrorEntity,
  NotionPropertyKind,
} from '../mirror-contract';
import type { VocabularyKey } from '@docket/work/vocabulary';

/** One Docket field that can become a column in a designed Notion database. */
export interface MirrorField {
  /** The Docket field key and property-map key. */
  readonly field: string;
  /** The default Notion column title. */
  readonly label: string;
  /** The Notion property kind the field provisions by default. */
  readonly kind: NotionPropertyKind;
  /** Whether a person representation can be selected for this field. */
  readonly personValued?: boolean;
  /** The parent field when this is a generated native-Notion-person companion. */
  readonly personCompanionOf?: string;
  /** Whether Notion requires this column to remain present. */
  readonly required?: boolean;
  /** The entity a relation column points at. */
  readonly relationEntity?: NotionMirrorEntity;
  /** Whether a two-way mirror applies edits from this column. */
  readonly writable?: boolean;
}

/** Everything the designer and synchronizer need to know about one projected entity. */
export interface MirrorEntitySpec {
  /** The Docket entity this database projects. */
  readonly entity: NotionMirrorEntity;
  /** Whether the entity accepts Notion-originated edits. */
  readonly direction: NotionMirrorDirection;
  /** The vocabulary key used to title the database, when it has one. */
  readonly vocabularyKey?: VocabularyKey;
  /** The static title when no vocabulary term applies. */
  readonly defaultTitle: string;
  /** Every field the entity can expose, in designer order. */
  readonly fields: readonly MirrorField[];
  /** The fields enabled in a newly-created design, in column order. */
  readonly defaultColumns: readonly string[];
}

/**
 * Docket states are per-team free text, so they use Notion selects rather than Notion's fixed
 * three-group status model.
 */
const STATE_KIND: NotionPropertyKind = 'select';

/** The read-only link back to the record in Docket. */
const DOCKET_URL_FIELD: MirrorField = {
  field: 'docketUrl',
  label: 'Open in Docket',
  kind: 'url',
};

/** The authored catalog before generated native-Notion-person companion fields are inserted. */
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
      { field: 'notionUser', label: 'Notion account', kind: 'people' },
      { field: 'hasDocketAccount', label: 'Has a Docket account', kind: 'checkbox' },
      { field: 'teams', label: 'Teams', kind: 'relation', relationEntity: 'team' },
    ],
    defaultColumns: ['displayName', 'email', 'jobTitle', 'notionUser', 'hasDocketAccount'],
  },
};

/** The generated native-Notion-person companion key for a person-valued field. */
export function personCompanionKey(parentField: string): string {
  return parentField + 'NotionPerson';
}

/** Insert native-Notion-person companions immediately after their text-capable parent fields. */
function withPersonCompanions(spec: MirrorEntitySpec): MirrorEntitySpec {
  return {
    ...spec,
    fields: spec.fields.flatMap((field) =>
      field.personValued === true
        ? [
            field,
            {
              field: personCompanionKey(field.field),
              label: field.label + ' (Notion)',
              kind: 'people' as const,
              personCompanionOf: field.field,
            },
          ]
        : [field],
    ),
  };
}

/** The full entity catalog, including generated native-Notion-person companion columns. */
export const MIRROR_ENTITY_SPECS: Record<NotionMirrorEntity, MirrorEntitySpec> = Object.fromEntries(
  Object.entries(AUTHORED_ENTITY_SPECS).map(([entity, spec]) => [
    entity,
    withPersonCompanions(spec),
  ]),
) as Record<NotionMirrorEntity, MirrorEntitySpec>;

/** Every entity kind in the order the designer presents them. */
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
