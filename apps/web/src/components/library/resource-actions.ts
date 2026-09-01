import type { SearchResult } from '../../lib/contracts/search';

import { hrefForSearchResult } from '@/lib/search-route';

/** The navigation behavior attached to a Library resource name. */
export interface ResourcePrimaryAction {
  readonly kind: 'download' | 'external' | 'internal';
  readonly label: string;
  readonly href: string;
}

/** Find one named search action with a usable target. */
function actionHref(resource: SearchResult, kind: string): string | null {
  const href = resource.actions.find((action) => action.kind === kind)?.href;
  return href && href.length > 0 ? href : null;
}

/** Build the action a resource name performs. */
export function primaryResourceAction(resource: SearchResult): ResourcePrimaryAction | null {
  const download = actionHref(resource, 'download');
  if (download) return { kind: 'download', label: 'Download', href: download };

  const external = actionHref(resource, 'open_external') ?? resource.externalUrl;
  if (external) return { kind: 'external', label: 'Open source', href: external };

  const internal = hrefForSearchResult(resource);
  if (!internal) return null;
  const subjectLabel = resource.subject?.kind ? resource.subject.kind.replaceAll('_', ' ') : null;
  return {
    kind: 'internal',
    label: subjectLabel ? `Open ${subjectLabel}` : 'Open in Docket',
    href: internal,
  };
}
