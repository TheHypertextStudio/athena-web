import { expect, it } from 'vitest';
import { activityDocumentKind, isActivityRedirectHref } from '../src/activity-routes';
const org = '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  id = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
it.each([
  `/orgs/${org}/work-templates/new`,
  `/orgs/${org}/work-templates/${id}?section=review&returnTo=${org}#included`,
  `/orgs/${org}/settings/templates/new`,
  `/orgs/${org}/settings/templates/${id}#included`,
])('classifies authoring at %s without caller hints', (href) => {
  expect(activityDocumentKind(href)).toBe('work-template-authoring');
});
it.each(['/plan/day?date=2026-10-07', '/plan?week=2026-10-05', `/orgs/${org}/plans/${id}`])(
  'recognizes sustained planning at %s',
  (href) => {
    expect(activityDocumentKind(href)).toBe('planning');
  },
);
it.each([
  `/orgs/${org}/work-templates`,
  `/orgs/${org}/work-templates/gallery`,
  `/orgs/${org}/work-templates/gallery/event`,
  `/orgs/${org}/settings/templates/gallery`,
  `/orgs/${org}/plans`,
  '/today',
  'https://example.com/plan/day',
])('keeps workspace or external paths out of activities: %s', (href) => {
  expect(activityDocumentKind(href)).toBeNull();
});
it('identifies only legacy authoring documents as redirects', () => {
  expect(isActivityRedirectHref(`/orgs/${org}/settings/templates/${id}`)).toBe(true);
  expect(isActivityRedirectHref(`/orgs/${org}/work-templates/${id}`)).toBe(false);
  expect(isActivityRedirectHref(`/orgs/${org}/settings/templates/gallery`)).toBe(false);
});
