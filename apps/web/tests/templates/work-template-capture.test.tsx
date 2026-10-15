import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkTemplateHeader } from '@/components/templates/work-template-header';
import { UserFacingError } from '@/lib/problem';

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  reset: vi.fn(),
  refresh: vi.fn(),
  navigate: vi.fn(),
  token: 'sha256:reviewed',
  previewError: false,
  previewPending: false,
  canContribute: true,
  canManage: false,
  policy: 'contributors',
  permissionPending: false,
}));
vi.mock('@/components/templates/work-template-capture-queries', () => ({
  captureAuthoringPolicyDef: () => ({ permission: true }),
  workTemplateCapturePreviewDef: () => ({ capture: true }),
  useWorkTemplateCapture: () => ({ mutateAsync: mocks.save, reset: mocks.reset, isPending: false }),
}));
vi.mock('@/components/settings/use-can-manage-org', () => ({
  useCanManageOrg: () => ({
    canManage: mocks.canManage,
    canContribute: mocks.canContribute,
    loading: false,
  }),
}));
vi.mock('@/lib/query', () => ({
  useApiQuery: (def: { permission?: boolean }) =>
    def.permission
      ? {
          data: { workTemplateAuthoring: mocks.policy },
          isPending: mocks.permissionPending,
          isError: false,
        }
      : {
          data: {
            sourceSnapshotToken: mocks.token,
            descendantCount: 1,
            definition: {
              name: 'Community dinner',
              payload: { targetType: 'project', description: '## Existing outline' },
              blueprint: {
                steps: [
                  {
                    key: 'prepare',
                    kind: 'task',
                    parentStepKey: null,
                    fields: { title: 'Book venue' },
                    optional: { enabled: false },
                    template: null,
                  },
                ],
                dependencies: [],
              },
            },
            warnings: [{ code: 'missing_anchor', paths: [['prepare']], count: 1 }],
          },
          isPending: mocks.previewPending,
          isFetching: false,
          isError: mocks.previewError,
          refetch: mocks.refresh,
        },
}));
vi.mock('@/lib/interactions/navigation', () => ({
  useAppRouter: () => ({ push: mocks.navigate }),
}));
vi.mock('@/components/editor/static-markdown', () => ({
  StaticMarkdown: ({ value }: { value: string }) => <p>{value}</p>,
}));

vi.mock('@/components/templates/work-template-identity-control', () => ({
  WorkTemplateIdentityControl: () => <span>Event · Version1</span>,
}));

beforeEach(() => {
  mocks.save.mockReset();
  mocks.reset.mockReset();
  mocks.refresh.mockReset();
  mocks.navigate.mockReset();
  mocks.token = 'sha256:reviewed';
  mocks.previewError = false;
  mocks.previewPending = false;
  mocks.canContribute = true;
  mocks.canManage = false;
  mocks.policy = 'contributors';
  mocks.permissionPending = false;
});
const header = () => (
  <WorkTemplateHeader orgId="org" kind="project" work={{ id: 'source' }} canEdit={false} />
);
function openCapture() {
  fireEvent.click(screen.getByRole('button', { name: 'Save as template' }));
}

describe('Save as template from visible work', () => {
  it.each(['task', 'project', 'initiative', 'program'] as const)(
    'offers independent capture from a visible %s without source edit permission',
    (kind) => {
      render(
        <WorkTemplateHeader orgId="org" kind={kind} work={{ id: 'source' }} canEdit={false} />,
      );
      expect(screen.getByRole('button', { name: 'Save as template' })).toBeVisible();
    },
  );

  it('reviews private scope and warnings, submits the authored name with its exact token, and opens the existing editor', async () => {
    mocks.save.mockResolvedValue({ template: { id: 'private-draft' } });
    render(header());
    openCapture();
    expect(screen.getByRole('dialog')).toHaveTextContent('Only you');
    expect(screen.getByRole('dialog')).toHaveTextContent('Book venue');
    expect(screen.getByRole('dialog')).toHaveTextContent(/no parent date/);
    fireEvent.change(screen.getByLabelText('Template name'), {
      target: { value: 'Neighborhood dinner' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save private draft' }));
    await waitFor(() => {
      expect(mocks.save).toHaveBeenCalledWith({
        name: 'Neighborhood dinner',
        sourceSnapshotToken: 'sha256:reviewed',
      });
    });
    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith('/orgs/org/settings/templates/private-draft');
    });
  });

  it('retains the name after stale rejection and explicit fresh review before retrying', async () => {
    mocks.save.mockRejectedValueOnce(
      new UserFacingError('Private provider diagnostic', { status: 409 }),
    );
    const view = render(header());
    openCapture();
    fireEvent.change(screen.getByLabelText('Template name'), {
      target: { value: 'My authored name' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save private draft' }));
    expect(await screen.findByText(/Source work changed/)).toBeVisible();
    expect(screen.getByLabelText('Template name')).toHaveValue('My authored name');
    expect(screen.queryByText('Private provider diagnostic')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save private draft' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh capture' }));
    expect(mocks.refresh).toHaveBeenCalledOnce();
    mocks.token = 'sha256:fresh';
    view.rerender(header());
    mocks.save.mockResolvedValueOnce({ template: { id: 'saved' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save private draft' }));
    await waitFor(() => {
      expect(mocks.save).toHaveBeenLastCalledWith({
        name: 'My authored name',
        sourceSnapshotToken: 'sha256:fresh',
      });
    });
  });

  it.each(['loading', 'failed'] as const)(
    'does not accept a %s capture or discard its authored name',
    (state) => {
      const view = render(header());
      openCapture();
      fireEvent.change(screen.getByLabelText('Template name'), {
        target: { value: 'Keep this name' },
      });
      mocks.previewPending = state === 'loading';
      mocks.previewError = state === 'failed';
      view.rerender(header());
      expect(screen.getByRole('button', { name: 'Save private draft' })).toBeDisabled();
      expect(screen.getByLabelText('Template name')).toHaveValue('Keep this name');
    },
  );

  it('hides capture for nonauthors and unresolved/admin-only policies', () => {
    mocks.canContribute = false;
    const view = render(header());
    expect(screen.queryByRole('button', { name: 'Save as template' })).not.toBeInTheDocument();
    mocks.canContribute = true;
    mocks.policy = 'admins';
    view.rerender(header());
    expect(screen.queryByRole('button', { name: 'Save as template' })).not.toBeInTheDocument();
    mocks.canManage = true;
    view.rerender(header());
    expect(screen.getByRole('button', { name: 'Save as template' })).toBeVisible();
    mocks.permissionPending = true;
    view.rerender(header());
    expect(screen.queryByRole('button', { name: 'Save as template' })).not.toBeInTheDocument();
  });
});
