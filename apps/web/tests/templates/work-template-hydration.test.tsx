import { ContextProvider, PageScrollProvider } from '@docket/ui/components';
import { mocks } from './work-template-authoring-fixture';
import { act, screen } from '@testing-library/react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { WorkTemplateAuthoring } from '@/components/templates/work-template-authoring';
vi.mock('@/components/active-org', () => ({
  useOptionalActiveOrg: () => ({
    orgs: [{ id: '01ARZ3NDEKTSV4RRFFQ69G5FAX', name: 'Neighborhood association' }],
  }),
}));

it('hydrates the server loading frame before using an already cached real client session', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  mocks.sessionPending = true;
  container.innerHTML = renderToString(
    <ContextProvider>
      <PageScrollProvider>
        <WorkTemplateAuthoring orgId="01ARZ3NDEKTSV4RRFFQ69G5FAX" id={null} />
      </PageScrollProvider>
    </ContextProvider>,
  );
  mocks.sessionPending = false;
  const recover = vi.fn();
  let root: Root | undefined;
  try {
    await act(async () => {
      root = hydrateRoot(
        container,
        <ContextProvider>
          <PageScrollProvider>
            <WorkTemplateAuthoring orgId="01ARZ3NDEKTSV4RRFFQ69G5FAX" id={null} />
          </PageScrollProvider>
        </ContextProvider>,
        { onRecoverableError: recover },
      );
    });
    expect(recover).not.toHaveBeenCalled();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Back to Work templates' })).toBeVisible();
    expect(screen.getByLabelText('Workspace')).toHaveTextContent('Neighborhood association');
    expect(screen.getByLabelText('Template name')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Name a kind of work' })).toBeVisible();
  } finally {
    await act(async () => {
      root?.unmount();
    });
    container.remove();
  }
});
