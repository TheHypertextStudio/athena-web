import { expect, it } from 'vitest';
import { workTemplateReturnHref } from '@/components/templates/work-template-return-context';
const org = '01ARZ3NDEKTSV4RRFFQ69G5FAX',
  parent = '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  child = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
it('returns through the actual workspace route to the parent review', () => {
  expect(workTemplateReturnHref(org, child, parent)).toBe(
    `/orgs/${org}/work-templates/${parent}?section=review`,
  );
});
it.each([
  null,
  'https://example.com',
  `/orgs/${org}/work-templates/${parent}`,
  child,
  '../settings',
])('ignores invalid, external or self navigation context %s', (candidate) => {
  expect(workTemplateReturnHref(org, child, candidate)).toBeNull();
});
