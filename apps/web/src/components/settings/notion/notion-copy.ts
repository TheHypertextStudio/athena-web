/**
 * `settings/notion` — application-owned copy for the Notion mirror surfaces.
 *
 * @remarks
 * Every user-visible string for this feature lives here rather than inline in JSX, for the same
 * reason the error contract requires app-owned fallbacks: the words are a product decision, and
 * scattering them through components makes them impossible to review as a set.
 *
 * Nothing here is derived from a provider response. A Notion error message never reaches the
 * screen; the UI branches on the error's type or status and renders one of these.
 */
import type { NotionMirrorEntity, NotionPersonRepresentation } from '@docket/types';

/** Shown on the hub when the databases have been designed but not yet created in Notion. */
export const EMPTY_DATABASE_HINT =
  'These are designed but not created yet. Review the columns, then create them in your Notion workspace.';

/** The plain-language name for each projected entity. */
const ENTITY_LABEL: Record<NotionMirrorEntity, string> = {
  task: 'Tasks',
  project: 'Projects',
  initiative: 'Initiatives',
  program: 'Programs',
  team: 'Teams',
  cycle: 'Cycles',
  milestone: 'Milestones',
  label: 'Labels',
  person: 'People',
};

/**
 * The entity's own name, independent of what the user titled its database.
 *
 * @param entity - The entity kind.
 * @returns the label to show beside a renamed database, so the binding stays legible.
 */
export function entityLabel(entity: NotionMirrorEntity): string {
  return ENTITY_LABEL[entity];
}

/** One person-representation option, as the designer offers it. */
export interface RepresentationChoice {
  readonly value: NotionPersonRepresentation;
  readonly label: string;
  readonly detail: string;
}

/**
 * How a person can appear in Notion, in the order the designer lists them.
 *
 * @remarks
 * Plain text leads because it is the only representation that can hold every human — including
 * everyone with no Notion account, which in most workspaces is most of the roster. The others are
 * upgrades, and each one's detail says plainly what it costs as well as what it buys.
 */
export const REPRESENTATION_CHOICES: readonly RepresentationChoice[] = [
  {
    value: 'text',
    label: 'Plain text',
    detail: 'Just the name. Works for everyone, no setup.',
  },
  {
    value: 'notion_person',
    label: 'Notion person',
    detail:
      'Native @-mentions and notifications — but only for people who have a Notion account in this workspace.',
  },
  {
    value: 'docket_people_table',
    label: 'Link to a People table',
    detail: 'Docket creates one. Everyone gets a row, account or not.',
  },
  {
    value: 'existing_table',
    label: 'Link to a table you already have',
    detail: 'Point the column at a database this workspace already keeps.',
  },
];

/** The label under a preview table when its rows are illustrative rather than real. */
export const SAMPLE_ROWS_NOTE =
  'Sample rows — this workspace has none of these yet. Real records appear here once you have some.';

/** Explains why the projected row count is lower than the workspace's total. */
export function excludedRowsNote(count: number): string {
  return count === 1
    ? '1 task is left out because it already syncs to one of your own Notion databases.'
    : `${String(count)} tasks are left out because they already sync to one of your own Notion databases.`;
}

/** Says which way a database's edits flow, in the user's terms. */
export function directionNote(direction: 'two_way' | 'push'): string {
  return direction === 'two_way'
    ? 'Edits in Notion flow back to Docket. If the same field changes in both places, Docket wins and the Notion value is kept in the sync history.'
    : 'This table is a view of Docket. Edits made in Notion are replaced on the next sync, and recorded so you can see what changed.';
}
