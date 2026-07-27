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

import type { McpRegistrar } from '../catalog';
import { CHANGE_REPORT_HTML } from './change-report';
import { UI_EXTENSION, UI_MIME_TYPE } from './runtime';
import { WORK_LIST_HTML } from './work-list';

export { UI_EXTENSION, UI_MIME_TYPE } from './runtime';

/** The `ui://` uri of each widget, referenced from the tools that render through it. */
export const WIDGET = {
  changeReport: 'ui://docket/change-report',
  workList: 'ui://docket/work-list',
} as const;

/**
 * Build the `_meta` a tool carries to declare its widget.
 *
 * @remarks
 * `visibility` is deliberately left unset, which the spec reads as `["model", "app"]` — every tool
 * here is one a person could reasonably ask for in words, so hiding any of them from the model
 * would remove a capability to gain nothing.
 *
 * @param resourceUri - The widget's `ui://` uri.
 * @returns the `_meta` object to spread into a tool config.
 */
export function widgetMeta(resourceUri: string): Record<string, unknown> {
  return { [UI_EXTENSION]: { resourceUri } };
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
};

/** Register every `ui://` widget resource on `server`. */
export function registerApps(server: McpRegistrar): void {
  for (const [uri, doc] of Object.entries(DOCUMENTS)) {
    server.registerResource(
      uri.replace('ui://docket/', 'ui-'),
      uri,
      { title: doc.title, description: doc.description, mimeType: UI_MIME_TYPE },
      (readUri): ReadResourceResult => ({
        contents: [{ uri: readUri.href, mimeType: UI_MIME_TYPE, text: doc.html }],
      }),
    );
  }
}
