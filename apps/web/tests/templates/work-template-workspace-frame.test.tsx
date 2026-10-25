import type { ComponentProps } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkTemplateWorkspaceFrame } from '@/components/templates/work-template-workspace-frame';
vi.mock('@/components/docket-link', () => ({
  default: (props: ComponentProps<'a'>) => <a {...props} />,
}));
afterEach(cleanup);
const orgId = '01ARZ3NDEKTSV4RRFFQ69G5FAX';
it('keeps a focused editor single-titled with a canonical workspace return trail', () => {
  render(
    <main>
      <WorkTemplateWorkspaceFrame orgId={orgId} parent={{ label: 'Work templates' }}>
        <h1>Event</h1>
        <p>Included work</p>
      </WorkTemplateWorkspaceFrame>
    </main>,
  );
  expect(
    within(screen.getByRole('main')).getByRole('heading', { level: 1, name: 'Event' }),
  ).toBeVisible();
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  expect(screen.getByRole('link', { name: 'Work templates' })).toHaveAttribute(
    'href',
    `/orgs/${orgId}/work-templates`,
  );
  expect(screen.queryByText('All settings')).not.toBeInTheDocument();
});
it('keeps page identity and navigation while real body data is pending', () => {
  render(
    <WorkTemplateWorkspaceFrame
      orgId={orgId}
      title="Choose starting points"
      parent={{ label: 'Work templates' }}
      loading
    >
      <p>Not loaded yet</p>
    </WorkTemplateWorkspaceFrame>,
  );
  expect(screen.getByRole('heading', { level: 1, name: 'Choose starting points' })).toBeVisible();
  expect(screen.getByRole('status', { name: 'Loading' })).toBeVisible();
  expect(screen.queryByText('Not loaded yet')).not.toBeInTheDocument();
});

it('uses the app shell main landmark without creating a second main', () => {
  render(
    <main>
      <WorkTemplateWorkspaceFrame orgId={orgId} title="Work templates">
        <p>Current work</p>
      </WorkTemplateWorkspaceFrame>
    </main>,
  );
  expect(screen.getAllByRole('main')).toHaveLength(1);
});
