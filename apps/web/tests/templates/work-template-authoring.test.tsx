import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WorkTemplateCreate } from '@docket/work/work-template-contract';
import { WorkTemplateForm } from '@/components/templates/work-template-authoring';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  draft: vi.fn(),
  publish: vi.fn(),
  canManage: false,
}));
vi.mock('@/components/templates/work-template-queries', () => ({
  workTemplateDef: () => ({}),
  workTemplateVersionsDef: () => ({}),
  useWorkTemplateWrites: () => ({
    create: { mutateAsync: mocks.create, isPending: false },
    draft: { mutateAsync: mocks.draft, isPending: false },
    publish: { mutateAsync: mocks.publish, isPending: false },
    archive: { isPending: false },
  }),
}));
vi.mock('@/components/settings/use-can-manage-org', () => ({
  useCanManageOrg: () => ({ canManage: mocks.canManage, loading: false }),
}));
vi.mock('@/components/pickers/use-composer-options', () => ({
  useComposerOptions: () => ({ teamOptions: [], labelOptions: [], loading: false }),
}));
vi.mock('@/components/statuses/status-registry', () => ({
  useStatusRegistry: () => ({ statusesFor: () => [] }),
}));
vi.mock('@/components/editor/freeform-text', () => ({
  FreeformTextEditor: ({
    value,
    onChange,
    ariaLabel,
  }: {
    value: string;
    onChange: (value: string) => void;
    ariaLabel: string;
  }) => (
    <textarea
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => {
        onChange(event.target.value);
      }}
    />
  ),
}));

describe('work-template sample authoring', () => {
  it.each(['task', 'project', 'initiative', 'program'] as const)(
    'saves a %s sample as a private draft without publishing',
    async (kind) => {
      const onCreated = vi.fn();
      mocks.create.mockImplementationOnce(async (input: WorkTemplateCreate) => ({
        id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        organizationId: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
        targetType: kind,
        status: 'draft',
        scope: 'personal',
        ownerActorId: null,
        teamId: null,
        isBase: false,
        revision: 0,
        definition: input.definition,
        offeredTeamIds: [],
        latestVersion: null,
        canEdit: true,
        createdAt: '2026-10-14T00:00:00Z',
        updatedAt: '2026-10-14T00:00:00Z',
      }));
      render(<WorkTemplateForm orgId="org" initial={null} onCreated={onCreated} />);
      fireEvent.change(screen.getByLabelText('Kind of work'), { target: { value: kind } });
      fireEvent.change(screen.getByLabelText('Template name'), { target: { value: 'Event' } });
      fireEvent.change(
        screen.getByLabelText(kind === 'task' ? 'Starting title' : 'Starting name'),
        { target: { value: 'Community dinner' } },
      );
      fireEvent.change(screen.getByLabelText('Starting document'), {
        target: { value: '## Preparation' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
      await waitFor(() => {
        expect(onCreated).toHaveBeenCalled();
      });
      expect(mocks.create).toHaveBeenLastCalledWith(
        expect.objectContaining({
          scope: 'personal',
          targetType: kind,
          definition: expect.objectContaining({
            payload: expect.objectContaining({
              targetType: kind,
              description: '## Preparation',
              [kind === 'task' ? 'title' : 'name']: 'Community dinner',
            }),
          }),
        }),
      );
      expect(mocks.publish).not.toHaveBeenCalled();
    },
  );
  it.each([false, true])(
    'offers team controls only to workspace administrators (manager=%s)',
    (canManage) => {
      mocks.canManage = canManage;
      render(<WorkTemplateForm orgId="org" initial={null} onCreated={vi.fn()} />);
      const control = screen.getByRole('button', { name: /Offer to teams/ });
      if (canManage) expect(control).toBeEnabled();
      else expect(control).toBeDisabled();
    },
  );
});
