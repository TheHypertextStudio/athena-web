import { describe, expect, it } from 'vitest';

import { OrganizationId, type SearchRoute } from '@docket/types';

import { hrefForSearchRoute, isExternalSearchHref } from '@/lib/search-route';

const ORG = OrganizationId.parse('01HZX5K3QJ9F8B7C6D5E4F3G2H');

describe('hrefForSearchRoute', () => {
  it('maps first-party entity routes onto existing app routes', () => {
    const route: SearchRoute = {
      type: 'entity',
      organizationId: ORG,
      entityKind: 'task',
      entityId: 'task_1',
      href: `/orgs/${ORG}/tasks/task_1`,
    };

    expect(hrefForSearchRoute(route)).toBe(`/orgs/${ORG}/tasks/task_1`);
  });

  it('normalizes broad entity routes that do not have detail pages', () => {
    expect(
      hrefForSearchRoute({
        type: 'entity',
        organizationId: ORG,
        entityKind: 'organization',
        entityId: ORG,
        href: `/orgs/${ORG}`,
      }),
    ).toBe(`/orgs/${ORG}/my-work`);

    expect(
      hrefForSearchRoute({
        type: 'entity',
        organizationId: ORG,
        entityKind: 'label',
        entityId: 'label_1',
        href: `/orgs/${ORG}/tasks?labelId=label_1`,
      }),
    ).toBe(`/orgs/${ORG}/my-work?labelId=label_1`);
  });

  it('routes content hits to their subject with a highlight query', () => {
    expect(
      hrefForSearchRoute({
        type: 'content',
        organizationId: ORG,
        subjectKind: 'project',
        subjectId: 'project_1',
        contentKind: 'comment',
        contentId: 'comment_1',
        href: `/orgs/${ORG}/search?subjectKind=project&subjectId=project_1&commentId=comment_1`,
      }),
    ).toBe(`/orgs/${ORG}/projects/project_1?commentId=comment_1`);
  });

  it('prefers external activity URLs and marks them as external', () => {
    const href = hrefForSearchRoute({
      type: 'activity',
      organizationId: ORG,
      eventId: 'event_1',
      href: `/orgs/${ORG}/stream?eventId=event_1`,
      externalUrl: 'https://linear.app/acme/issue/ENG-1',
    });

    expect(href).toBe('https://linear.app/acme/issue/ENG-1');
    expect(isExternalSearchHref(href)).toBe(true);
  });

  it('keeps user-private calendar hits on the authenticated search surface', () => {
    expect(
      hrefForSearchRoute({
        type: 'calendar_event',
        calendarEventId: 'cal_1',
        href: '/agenda?eventId=cal_1',
      }),
    ).toBe('/search?kind=calendar_event&id=cal_1');
  });
});
