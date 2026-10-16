import { OrganizationId } from '@docket/identity-access/ids';
import { buildAuthenticatedHref, parseAuthenticatedRoute } from '@/lib/authenticated-route';

/** Build an entry into the dedicated work-definition workspace for the actual route organization. */
export function workTemplateHref(orgId: string, suffix = ''): string {
  const root = buildAuthenticatedHref('/orgs/[orgId]/work-templates', {
    orgId: OrganizationId.parse(orgId),
  });
  const separator = suffix && !/^[/?#]/.test(suffix) ? '/' : '';
  return `${root}${separator}${suffix}`;
}

/** Translate a recognized legacy template route while retaining its query and focus fragment. */
export function legacyWorkTemplateHref(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href, 'https://docket.local');
  } catch {
    return null;
  }
  if (url.origin !== 'https://docket.local') return null;
  const match = parseAuthenticatedRoute(url.pathname);
  if (
    match.kind !== 'matched' ||
    !match.route.pattern.startsWith('/orgs/[orgId]/settings/templates')
  )
    return null;
  return `${url.pathname.replace('/settings/templates', '/work-templates')}${url.search}${url.hash}`;
}
