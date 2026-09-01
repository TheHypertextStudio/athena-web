/**
 * `@docket/api` — the MCP Apps surface (`io.modelcontextprotocol/ui`, SEP-1865).
 *
 * @remarks
 * Widgets are served as ordinary MCP resources under the reserved `ui://` scheme with the
 * extension's `text/html;profile=mcp-app` mimeType, and tools point at theirs through
 * `_meta.ui.resourceUri`. That is the whole linkage: a host that does not implement the extension
 * ignores the `_meta` key and shows the JSON, so declaring a widget can never make the surface
 * worse for a client that cannot render one.
 *
 * Documents are self-contained by necessity, not preference — the host serves them under a
 * deny-all CSP, so there is no CDN, no external stylesheet, and no font to fetch.
 *
 * These are purpose-built HTML rather than the Next.js app in an iframe. The app's components
 * assume its providers, its router, and its session; none of those exist here, and a widget that
 * boots half an application inside a transcript is slower and more fragile than one that renders
 * the four facts it was given.
 */
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

import { MCP_UI_META_KEY, type McpUiResourceMeta } from '@docket/integrations/mcp-apps-contract';

import type { McpRegistrar } from '../catalog';
import { CHANGE_REPORT_HTML } from './change-report';
import { entityDocument, ENTITY_HTML } from './entity';
import { PLAN_HTML } from './plan';
import { UI_EXTENSION, UI_MIME_TYPE } from './runtime';
import { WORK_LIST_HTML } from './work-list';

export { UI_EXTENSION, UI_MIME_TYPE } from './runtime';

/** The `ui://` uri of each widget, referenced from the tools that render through it. */
export const WIDGET = {
  changeReport: 'ui://docket/change-report',
  workList: 'ui://docket/work-list',
  entity: 'ui://docket/entity',
  tasks: 'ui://docket/tasks',
  projects: 'ui://docket/projects',
  programs: 'ui://docket/programs',
  initiatives: 'ui://docket/initiatives',
  cycles: 'ui://docket/cycles',
  teams: 'ui://docket/teams',
  updates: 'ui://docket/updates',
  comments: 'ui://docket/comments',
  sessions: 'ui://docket/sessions',
  agents: 'ui://docket/agents',
  views: 'ui://docket/views',
  organizations: 'ui://docket/organizations',
  plan: 'ui://docket/plan',
} as const;

/**
 * Build the `_meta` a tool carries to declare its widget.
 *
 * @remarks
 * `visibility` is deliberately left unset, which the spec reads as `["model", "app"]` — every tool
 * here is one a person could reasonably ask for in words, so hiding any of them from the model
 * would remove a capability to gain nothing.
 *
 * TWO keys are emitted for one declaration. The stable specification (2026-01-26) spells the
 * linkage `_meta.ui`; hosts written against the pre-stable drafts looked under the full extension
 * identifier instead, and several shipped that way. `_meta` is an open map, so carrying both
 * costs a few bytes and means a widget renders in either generation of host rather than silently
 * degrading to JSON in one of them. Readers must prefer `_meta.ui`.
 *
 * @param resourceUri - The widget's `ui://` uri.
 * @returns the `_meta` object to spread into a tool config.
 */
export function widgetMeta(
  resourceUri: string,
  visibility?: readonly ('model' | 'app')[],
): Record<string, unknown> {
  const value = { resourceUri, ...(visibility ? { visibility } : {}) };
  return { [MCP_UI_META_KEY]: value, [UI_EXTENSION]: value };
}

/** Every widget document, by uri. */
const DOCUMENTS: Readonly<Record<string, { title: string; description: string; html: string }>> = {
  [WIDGET.changeReport]: {
    title: 'Change report',
    description:
      'What a write actually did, as before → after per item, including what it could not touch and why. Carries the undo for that change.',
    html: CHANGE_REPORT_HTML,
  },
  [WIDGET.workList]: {
    title: 'Work list',
    description: 'A scannable view of the set a query matched.',
    html: WORK_LIST_HTML,
  },
  [WIDGET.entity]: {
    title: 'Entity',
    description:
      'One piece of work with its current state, what is blocking it, and where it came from.',
    html: ENTITY_HTML,
  },
  [WIDGET.tasks]: { title: 'Tasks', description: 'Task details.', html: entityDocument('task') },
  [WIDGET.projects]: {
    title: 'Projects',
    description: 'Project outcome, health, milestones, and latest update.',
    html: entityDocument('project'),
  },
  [WIDGET.programs]: {
    title: 'Programs',
    description: 'Program health, rollup, and associated planning work.',
    html: entityDocument('program'),
  },
  [WIDGET.initiatives]: {
    title: 'Initiatives',
    description: 'Initiative outcome, health, and associated programs and projects.',
    html: entityDocument('initiative'),
  },
  [WIDGET.cycles]: {
    title: 'Cycles',
    description: 'Cycle window and work.',
    html: entityDocument('cycle'),
  },
  [WIDGET.teams]: {
    title: 'Teams',
    description: 'Team workflow and membership.',
    html: entityDocument('team'),
  },
  [WIDGET.updates]: {
    title: 'Updates',
    description: 'Status updates.',
    html: entityDocument('update'),
  },
  [WIDGET.comments]: {
    title: 'Comments',
    description: 'Comments.',
    html: entityDocument('comment'),
  },
  [WIDGET.sessions]: {
    title: 'Sessions',
    description: 'Agent session activity.',
    html: entityDocument('session'),
  },
  [WIDGET.agents]: {
    title: 'Agents',
    description: 'Agent policy and guidance.',
    html: entityDocument('agent'),
  },
  [WIDGET.views]: {
    title: 'Views',
    description: 'Saved view definitions.',
    html: entityDocument('view'),
  },
  [WIDGET.organizations]: {
    title: 'Organizations',
    description: 'Organization summary and counts.',
    html: entityDocument('org'),
  },
  [WIDGET.plan]: {
    title: 'Day plan',
    description: 'A day in order, with its timeboxes and what is left.',
    html: PLAN_HTML,
  },
};

/**
 * What every widget document declares about the frame it wants.
 *
 * @remarks
 * Emitted under both spellings for the same reason {@link widgetMeta} is.
 *
 * `prefersBorder: false` is the whole payload today, and it is not cosmetic: the document draws its
 * own card, so a host that also draws one nests two borders around the same content. Declaring the
 * preference is how a host knows to stay out of the way. Nothing here asks for a CSP relaxation or
 * a browser permission — a widget that needed either would be doing something these four do not.
 */
const RESOURCE_META: McpUiResourceMeta = { prefersBorder: false };

/** Register every `ui://` widget resource on `server`. */
export function registerApps(server: McpRegistrar): void {
  for (const [uri, doc] of Object.entries(DOCUMENTS)) {
    server.registerResource(
      uri.replace('ui://docket/', 'ui-'),
      uri,
      { title: doc.title, description: doc.description, mimeType: UI_MIME_TYPE },
      (readUri): ReadResourceResult => ({
        contents: [
          {
            uri: readUri.href,
            mimeType: UI_MIME_TYPE,
            text: doc.html,
            _meta: { [MCP_UI_META_KEY]: RESOURCE_META, [UI_EXTENSION]: RESOURCE_META },
          },
        ],
      }),
    );
  }
}
