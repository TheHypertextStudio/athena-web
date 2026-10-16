/** Independent document families whose pages never render under workspace chrome. */
export type ActivityDocumentKind = 'planning' | 'work-template-authoring';
function authoringPath(href: string): RegExpMatchArray | null {
  const path = href.split(/[?#]/, 1)[0] ?? '';
  return /^\/orgs\/[^/]+\/(work-templates|settings\/templates)\/([^/]+)\/?$/.exec(path);
}
/** Classify activity destinations centrally for links, imperative transport and offline documents. */
export function activityDocumentKind(href: string): ActivityDocumentKind | null {
  const path = href.split(/[?#]/, 1)[0];
  if (
    path === '/plan/day' ||
    path === '/plan' ||
    /^\/orgs\/[^/]+\/plans\/[^/]+\/?$/.test(path ?? '')
  )
    return 'planning';
  const author = authoringPath(href);
  return author && author[2] !== 'gallery' ? 'work-template-authoring' : null;
}
/** Legacy authoring redirect documents may be cached exactly but cannot become an activity fallback. */
export function isActivityRedirectHref(href: string): boolean {
  const author = authoringPath(href);
  return author?.[1] === 'settings/templates' && author[2] !== 'gallery';
}
