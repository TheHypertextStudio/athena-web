/** Independent document families whose pages never render under workspace chrome. */
export type ActivityDocumentKind =
  | 'planning'
  | 'work-template-authoring'
  | 'work-template-gallery'
  | 'work-template-review'
  | 'work-template-copy'
  | 'work-template-conversion'
  | 'work-template-suggestion';
function authoringPath(href: string): RegExpMatchArray | null {
  const path = href.split(/[?#]/, 1)[0] ?? '';
  return /^\/orgs\/[^/]+\/(work-templates|settings\/templates)\/([^/]+)\/?$/.exec(path);
}
const activityPaths: readonly (readonly [ActivityDocumentKind, RegExp])[] = [
  ['planning', /^(?:\/plan(?:\/day)?|\/orgs\/[^/]+\/plans\/[^/]+\/?)$/],
  [
    'work-template-gallery',
    /^\/orgs\/[^/]+\/work-templates\/gallery(?:\/(?:copies\/[^/]+|[^/]+))?\/?$/,
  ],
  ['work-template-review', /^\/orgs\/[^/]+\/work-templates\/review\/[^/]+\/?$/],
  ['work-template-copy', /^\/orgs\/[^/]+\/work-templates\/copy\/[^/]+\/?$/],
  ['work-template-conversion', /^\/orgs\/[^/]+\/work-templates\/convert-labels\/?$/],
  ['work-template-suggestion', /^\/orgs\/[^/]+\/work-templates\/suggest-from-labels\/?$/],
];
/** Classify activity destinations centrally for links, imperative transport and offline documents. */
export function activityDocumentKind(href: string): ActivityDocumentKind | null {
  const path = href.split(/[?#]/, 1)[0] ?? '';
  const matched = activityPaths.find(([, pattern]) => pattern.test(path));
  if (matched) return matched[0];
  const author = authoringPath(href);
  return author && author[2] !== 'gallery' ? 'work-template-authoring' : null;
}
/** Legacy authoring redirect documents may be cached exactly but cannot become an activity fallback. */
export function isActivityRedirectHref(href: string): boolean {
  const author = authoringPath(href);
  return author?.[1] === 'settings/templates' && author[2] !== 'gallery';
}
