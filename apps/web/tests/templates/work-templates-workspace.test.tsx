import type { ComponentProps } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkTemplatesWorkspace } from '@/components/templates/work-templates-workspace';
vi.mock('@/components/docket-link', () => ({
  default: (props: ComponentProps<'a'>) => <a {...props} />,
}));
vi.mock('@/lib/query', () => ({
  useApiListQuery: () => ({ data: { items: [] }, isPending: false, isError: false }),
  useApiQuery: () => ({ data: {}, isPending: false, isError: false }),
  apiQueryOptions: () => ({}),
  queryKeys: { organization: vi.fn(), templates: vi.fn() },
  useApiMutation: () => ({}),
  unwrap: vi.fn(),
}));
vi.mock('@/components/templates/work-template-queries', () => ({ workTemplatesDef: () => ({}) }));
vi.mock('@/components/settings/use-can-manage-org', () => ({
  useCanManageOrg: () => ({ canManage: false }),
}));
afterEach(cleanup);
it('is a dedicated main workspace with one Work templates page title', () => {
  render(
    <main>
      <WorkTemplatesWorkspace orgId="01ARZ3NDEKTSV4RRFFQ69G5FAX" />
    </main>,
  );
  expect(screen.getByRole('main')).toContainElement(
    screen.getByRole('heading', { level: 1, name: 'Work templates' }),
  );
});
it('keeps administrative template permissions outside the work definition flow', () => {
  render(
    <main>
      <WorkTemplatesWorkspace orgId="01ARZ3NDEKTSV4RRFFQ69G5FAX" />
    </main>,
  );
  expect(screen.queryByRole('button', { name: 'Template permissions' })).not.toBeInTheDocument();
});
it('enters choosing and defining work through canonical workspace routes', () => {
  render(
    <main>
      <WorkTemplatesWorkspace orgId="01ARZ3NDEKTSV4RRFFQ69G5FAX" />
    </main>,
  );
  expect(screen.getByRole('link', { name: 'Choose starting work' })).toHaveAttribute(
    'href',
    '/orgs/01ARZ3NDEKTSV4RRFFQ69G5FAX/work-templates/gallery',
  );
  expect(screen.getByRole('link', { name: 'Define work' })).toHaveAttribute(
    'href',
    '/orgs/01ARZ3NDEKTSV4RRFFQ69G5FAX/work-templates/new',
  );
});
