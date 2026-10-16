import { describe, expect, it } from 'vitest';
import {
  legacyWorkTemplateHref,
  workTemplateHref,
} from '@/components/templates/work-template-navigation';
import { parseAuthenticatedRoute } from '@/lib/authenticated-route';
import { OFFLINE_ROUTES } from '@/lib/offline-routes.generated';

const ORG_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const TEMPLATE_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const BUNDLE_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAX';
const ROOT = `/orgs/${ORG_ID}`;
const destinations = [
  ['', ''],
  ['/new', '/new'],
  [`/${TEMPLATE_ID}`, '/[templateId]'],
  ['/gallery', '/gallery'],
  ['/gallery/event', '/gallery/[slug]'],
  ['/gallery/review', '/gallery/review'],
  [`/gallery/copies/${BUNDLE_ID}`, '/gallery/copies/[bundleId]'],
] as const;

describe('work-template workspace navigation', () => {
  it.each(destinations)(
    'moves the exact legacy %s leaf without changing its identity',
    (suffix) => {
      expect(legacyWorkTemplateHref(`${ROOT}/settings/templates${suffix}`)).toBe(
        `${ROOT}/work-templates${suffix}`,
      );
      expect(workTemplateHref(ORG_ID, suffix)).toBe(`${ROOT}/work-templates${suffix}`);
    },
  );

  it.each(destinations)(
    'keeps canonical %s available to the local route outlet',
    (suffix, pattern) => {
      const pathname = workTemplateHref(ORG_ID, suffix);
      const expected = `/orgs/[orgId]/work-templates${pattern}`;
      const match = parseAuthenticatedRoute(pathname);
      expect(match.kind).toBe('matched');
      if (match.kind !== 'matched') throw new Error('Canonical route is not available.');
      expect(match.route.pattern).toBe(expected);
      expect(match.route.params).toMatchObject({ orgId: ORG_ID });
      expect(OFFLINE_ROUTES.some((route) => route.pattern === expected)).toBe(true);
    },
  );

  it('retains explicit review, repeated query values and focus without changing the template ID', () => {
    const suffix = `/${TEMPLATE_ID}?section=review&label=one&label=two#tabpanel-review`;
    expect(legacyWorkTemplateHref(`${ROOT}/settings/templates${suffix}`)).toBe(
      `${ROOT}/work-templates${suffix}`,
    );
  });

  it('accepts a relative suffix with or without a slash and retains query-only destinations', () => {
    expect(workTemplateHref(ORG_ID, 'gallery')).toBe(`${ROOT}/work-templates/gallery`);
    expect(workTemplateHref(ORG_ID, '/gallery')).toBe(`${ROOT}/work-templates/gallery`);
    expect(workTemplateHref(ORG_ID, '?section=review#tabpanel-review')).toBe(
      `${ROOT}/work-templates?section=review#tabpanel-review`,
    );
    expect(workTemplateHref(ORG_ID, '#template-event')).toBe(
      `${ROOT}/work-templates#template-event`,
    );
  });

  it('retains the original saved-copy identity and escaped focus fragment', () => {
    const suffix = `/gallery/copies/${BUNDLE_ID}?source=Event%20draft#review%20Vendor`;
    expect(legacyWorkTemplateHref(`https://docket.local${ROOT}/settings/templates${suffix}`)).toBe(
      `${ROOT}/work-templates${suffix}`,
    );
  });

  it.each([
    '/settings/templates',
    `${ROOT}/settings/templates-other`,
    `${ROOT}/settings/templates/gallery/copies/${BUNDLE_ID}/extra`,
    `${ROOT}/work-templates/gallery`,
    '/orgs/not-an-org/settings/templates',
    `https://example.com${ROOT}/settings/templates`,
    `//example.com${ROOT}/settings/templates`,
    `javascript:${ROOT}/settings/templates`,
    'http://[',
  ])('refuses unknown or unsafe legacy destination %s', (href) => {
    expect(legacyWorkTemplateHref(href)).toBeNull();
  });

  it('refuses an invalid workspace before constructing a navigation target', () => {
    expect(() => workTemplateHref('not-an-org')).toThrow();
  });
});
