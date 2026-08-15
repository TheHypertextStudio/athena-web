/** SDK response translation for the designed Notion mirror. */
import {
  isFullPage,
  type PageObjectResponse,
  type PartialPageObjectResponse,
} from '@notionhq/client';

import type { MirrorChange, MirrorPageParentKind, MirrorParentPage } from '../mirror-port';

/** Narrow SDK search or query results to pages that carry properties. */
export function fullPages(
  results: readonly (PageObjectResponse | PartialPageObjectResponse | object)[],
): PageObjectResponse[] {
  return results.filter((result): result is PageObjectResponse =>
    isFullPage(result as PageObjectResponse),
  );
}

/** Read a page title from whichever property carries it. */
function pageTitle(page: PageObjectResponse): string {
  for (const value of Object.values(page.properties)) {
    if (value.type !== 'title') continue;
    const text = value.title.map((part) => part.plain_text).join('');
    if (text.length > 0) return text;
  }
  return 'Untitled';
}

/** Provider placement names the picker displays. */
const PARENT_KIND: Partial<Record<PageObjectResponse['parent']['type'], MirrorPageParentKind>> = {
  workspace: 'workspace',
  page_id: 'page',
  data_source_id: 'database',
  database_id: 'database',
};

/** Map a full SDK page response onto the parent-page shape the setup flow needs. */
export function toParentPage(page: PageObjectResponse): MirrorParentPage {
  const parentKind = PARENT_KIND[page.parent.type];
  return {
    id: page.id,
    title: pageTitle(page),
    ...(typeof page.url === 'string' ? { url: page.url } : {}),
    ...(page.icon?.type === 'emoji' ? { icon: page.icon.emoji } : {}),
    lastEditedTime: page.last_edited_time,
    ...(parentKind !== undefined ? { parentKind } : {}),
  };
}

/** Map a full SDK page response onto the workflow's provider-change shape. */
export function toMirrorChange(page: PageObjectResponse, archived: boolean): MirrorChange {
  return {
    externalPageId: page.id,
    externalUpdatedAt: page.last_edited_time,
    archived: archived || page.in_trash,
    properties: page.properties,
    lastEditedBy: page.last_edited_by.id,
  };
}
