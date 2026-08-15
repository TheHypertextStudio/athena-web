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
import type {
  NotionMirrorEntity,
  NotionPersonRepresentation,
} from '@docket/connections/notion/mirror-contract';

/** Shown inside the preview disclosure when the databases have been designed but not created. */
export const EMPTY_DATABASE_HINT =
  'None of these exist in Notion yet. Customize any of them before you create them, or leave them as they are.';

/** The setup card's heading — the one action a fresh Notion connection is waiting on. */
export const SETUP_TITLE = 'Set up Docket in Notion';

/**
 * The setup card's explanation.
 *
 * @remarks
 * Three sentences doing three jobs: say what will happen, say that it is reversible, and say that
 * nothing happens until asked. The copy this replaces did only the first, which is why choosing a
 * page read as a weighty, permanent decision about somebody else's workspace — when in truth
 * Docket addresses its databases by id, so they can be dragged anywhere in Notion afterwards.
 */
export const SETUP_BODY =
  'Pick a page in your Notion workspace. Docket builds its databases inside it and keeps them current. You can move them anywhere in Notion afterwards — Docket keeps up. Nothing is created until you press Create.';

/** The label above the page picker. */
export const SETUP_PAGE_LABEL = 'Build them under';

/** The setup card's primary action, and its in-flight form. */
export const SETUP_ACTION = 'Create in Notion';
/** Shown on the button while the provision run is in flight. */
export const SETUP_ACTION_BUSY = 'Creating…';

/** Shown under the button while the provision run is in flight. */
export const SETUP_RUNNING =
  'Building your databases and filling them in. This can take a minute for a large workspace — you can leave this page.';

/** Shown when a provision run reports a status other than success. */
export const SETUP_FAILED =
  'Docket could not finish creating your Notion databases. Check the connection and try again.';

/** The hub's manual-run action, and its in-flight form. */
export const SYNC_ACTION = 'Sync now';
/** Shown on the button while a mirror pass is in flight. */
export const SYNC_ACTION_BUSY = 'Syncing…';

/**
 * Shown when a manual mirror run reports a status other than success.
 *
 * @remarks
 * Deliberately says what to do rather than what went wrong. The reason lives in the run record
 * and is provider-authored text; repeating it here would put Notion's words in Docket's mouth,
 * and it is rarely actionable anyway.
 */
export const SYNC_FAILED =
  'Docket could not finish updating your Notion databases. Check the connection and try again.';

/**
 * Shown when the LAST mirror run failed but the connection itself is fine.
 *
 * @remarks
 * The state that used to be invisible: the credential works, so the connection reads healthy
 * everywhere, while the thing this page is about has not run successfully. Without this the page
 * showed a green chip and a reassuring "Last updated" stamp from before the breakage.
 */
export const MIRROR_FAILED_TITLE = 'The last update to Notion didn’t finish.';
/** What to do about {@link MIRROR_FAILED_TITLE}. */
export const MIRROR_FAILED_DETAIL =
  'What’s in Notion is older than what’s in Docket. Try running it again.';

/** The follow-up line on the hub's broken-connection alert, naming this surface's recovery path. */
export const CONNECTION_ERROR_DETAIL =
  'Reconnect Notion from Connections to resume syncing. Your designed databases are kept.';

/** The collapsed group of people who were deliberately excluded. */
export function ignoredTitle(count: number): string {
  return count === 1 ? '1 person you’re not syncing' : `${String(count)} people you’re not syncing`;
}

/**
 * What being skipped actually means, and that it can be undone.
 *
 * @remarks
 * Says the consequence rather than restating the setting. Somebody who skipped a person months ago
 * needs to know what that is still doing — not that they once clicked a button.
 */
export const IGNORED_DETAIL =
  'Anything assigned to them in Notion won’t reach Docket. You can change your mind at any time.';

/** The action that returns a skipped person to the list of decisions still to make. */
export const UNIGNORE_ACTION = 'Sort out';

/**
 * Shown when the connection can see no Notion pages at all.
 *
 * @remarks
 * A public Notion integration only sees what was ticked during consent, so this is a common
 * first-run state rather than a fault. The copy it replaces told the reader to open Notion's •••
 * menu and then *reload this page* — a dead end dressed as instructions. Pairs with
 * {@link NO_PAGES_ACTION}, which reopens the consent screen in place.
 */
export const NO_PAGES_HINT =
  'Docket can’t see any pages in your Notion workspace. Notion only shares the pages you tick when you connect, so there may be nothing shared yet.';

/** The action beside {@link NO_PAGES_HINT}: reopen Notion's consent screen. */
export const NO_PAGES_ACTION = 'Choose pages to share';

/** The page picker's empty-trigger prompt. */
export const PAGE_PICKER_PLACEHOLDER = 'Choose a page';
/** The page picker's search-field placeholder. */
export const PAGE_PICKER_SEARCH = 'Search your Notion pages…';
/** Shown in the picker before anything is typed and nothing came back. */
export const PAGE_PICKER_IDLE = 'No pages shared with Docket yet.';
/** Shown in the picker when a typed query matched nothing. */
export const PAGE_PICKER_EMPTY = 'No pages match.';

/**
 * Where a Notion page sits, for the picker's second line.
 *
 * @param kind - The page's parent kind, or null when Notion did not say.
 * @returns a short placement phrase, or undefined when there is nothing to add.
 */
export function pagePlacement(kind: 'workspace' | 'page' | 'database' | null): string | undefined {
  if (kind === 'workspace') return 'Top level';
  if (kind === 'page') return 'Inside another page';
  if (kind === 'database') return 'Inside a database';
  return undefined;
}

/** The disclosure heading listing what provisioning will create. */
export function previewSummary(count: number): string {
  return `What Docket will create · ${String(count)} ${count === 1 ? 'table' : 'tables'}`;
}

/** The heading over the created tables, once they exist. */
export const PROVISIONED_TITLE = 'Tables Docket builds for you';

/** The subtitle under {@link PROVISIONED_TITLE}. */
export const PROVISIONED_HINT =
  'Each of these is a Notion database Docket fills in and keeps current. Configure one to change its name or which columns it has.';

/** The label on the row naming the page the databases were built under. */
export const CONTAINER_LABEL = 'Where this lives';

/** Used when a connection was provisioned before the container page's title was recorded. */
export const CONTAINER_UNKNOWN = 'A page in your Notion workspace';

/** The reassurance beside {@link CONTAINER_LABEL}. */
export const CONTAINER_NOTE =
  'Move it anywhere in Notion — Docket keeps up. Deleting it removes the databases.';

/** The per-row link out to the real Notion database. */
export const OPEN_IN_NOTION = 'Open in Notion';

/**
 * The per-row action, which reads differently before and after the table exists.
 *
 * @param provisioned - Whether the table has been created in Notion.
 * @returns the link label.
 */
export function tableAction(provisioned: boolean): string {
  // Two different offers: one shapes something about to be built, the other changes something live.
  return provisioned ? 'Configure' : 'Customize';
}

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
      'Adds a second column for native @-mentions and notifications, beside the name. Only people with a Notion account in this workspace appear in it.',
  },
  {
    value: 'docket_people_table',
    label: 'Link to a People table',
    detail: 'Docket creates one. Everyone gets a row, account or not.',
  },
  // `existing_table` is deliberately absent. Docket owns no page ids in a database it did not
  // create, so it could never fill such a column in — it was selectable and did nothing. The
  // server refuses it too; this only keeps the dead choice off the screen.
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

/**
 * What one table does, in a sentence a reader can act on.
 *
 * @remarks
 * Replaces the "Two-way / From Docket" chip, which named a mechanism nobody asked about. What a
 * person needs to know before clicking Configure is whether their edits in Notion will survive.
 *
 * @param direction - Whether the table accepts edits from Notion.
 * @param plural - The org's own plural term for the entity.
 * @returns one line of plain meaning.
 */
export function tableMeaning(direction: 'two_way' | 'push', plural: string): string {
  return direction === 'two_way'
    ? `Your ${plural.toLowerCase()} appear in Notion, and edits there come back to Docket.`
    : `A live copy of your ${plural.toLowerCase()} in Notion. Edits there get replaced.`;
}

/** Says which way a database's edits flow, in the user's terms. */
export function directionNote(direction: 'two_way' | 'push'): string {
  return direction === 'two_way'
    ? 'Edits in Notion flow back to Docket. If the same field changes in both places, Docket wins and the Notion value is kept in the sync history.'
    : 'This table is a view of Docket. Edits made in Notion are replaced on the next sync, and recorded so you can see what changed.';
}
