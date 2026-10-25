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

it.each([
  `/orgs/${org}/work-templates/gallery?fork=nonprofit`,
  `/orgs/${org}/work-templates/gallery/event`,
  `/orgs/${org}/work-templates/gallery/review`,
  `/orgs/${org}/work-templates/gallery/copies/${id}`,
])('keeps choosing organizational work in a focused document: %s', (href) => {
  expect(activityDocumentKind(href)).toBe('work-template-gallery');
});

it('opens the exact received proposal in its own focused review document', () => {
  expect(activityDocumentKind(`/orgs/${org}/work-templates/review/${id}?from=inbox`)).toBe(
    'work-template-review',
  );
  expect(activityDocumentKind(`/orgs/${org}/settings/templates/review/${id}`)).toBeNull();
});
it('keeps a workspace copy in a separate focused document', () => {
  expect(activityDocumentKind(`/orgs/${org}/work-templates/copy/opaque-attempt`)).toBe(
    'work-template-copy',
  );
});
it('isolates explicit label conversion from authoring and workspace navigation', () => {
  expect(activityDocumentKind(`/orgs/${org}/work-templates/convert-labels?group=${id}`)).toBe(
    'work-template-conversion',
  );
});

it('isolates label-based suggestions from conversion and authoring', () => {
  expect(activityDocumentKind(`/orgs/${org}/work-templates/suggest-from-labels?group=${id}`)).toBe(
    'work-template-suggestion',
  );
});
