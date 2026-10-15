import { deferred } from '../support/deferred';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { VocabularyProvider } from '@docket/ui/hooks';
import { describe, expect, it, vi } from 'vitest';
import { TeamId } from '@docket/identity-access/ids';
import type { BlueprintPreviewRequest } from '@/components/composer/blueprint-preview-queries';
import { WorkTypeId, WorkTypeVersionId } from '@docket/work/ids';
import type {
  BlueprintCreationOptions,
  BlueprintCreationPreview,
} from '@docket/work/work-template-blueprint';
import { useBlueprintCreationReview } from '@/components/composer/use-blueprint-creation-review';

const mocks = vi.hoisted(() => ({ preview: vi.fn() }));
vi.mock('@/components/composer/blueprint-preview-queries', () => ({
  blueprintCreationTeamsDef: () => ({}),
  useBlueprintPreview: () => ({ mutateAsync: mocks.preview, isPending: false }),
}));
vi.mock('@/components/templates/work-template-queries', () => ({ workTemplatesDef: () => ({}) }));
vi.mock('@/lib/query', () => ({ useApiQuery: () => ({ data: { items: [] } }) }));
const id = WorkTypeId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV');
function fixture(): BlueprintCreationPreview {
  return {
    workTypeId: id,
    workTypeVersionId: WorkTypeVersionId.parse(id),
    previewToken: `sha256:${'a'.repeat(64)}`,
    resolvedManifest: [],
    defaultSchedules: [],
    selectedCount: 2,
    additionalMilestoneCount: 0,
    descendantCount: 1,
    summaryOffset: 0,
    nextSummaryOffset: null,
    warnings: [],
    descendants: [
      {
        path: ['prepare'],
        parentPath: [],
        kind: 'task',
        title: 'Prepare dinner',
        workTypeId: id,
        workTypeVersionId: WorkTypeVersionId.parse(id),
        dates: { dueDate: '2026-10-20' },
        unresolvedReasons: {},
        optional: true,
        selectedByDefault: true,
        selected: true,
        prerequisites: [],
      },
    ],
  };
}
function requestFor(kind: BlueprintPreviewRequest['kind'], name: string): BlueprintPreviewRequest {
  switch (kind) {
    case 'task':
      return {
        kind,
        body: { title: name, teamId: TeamId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAX'), workTypeId: id },
      };
    case 'project':
      return { kind, body: { name, workTypeId: id } };
    case 'initiative':
      return { kind, body: { name, workTypeId: id } };
    case 'program':
      return { kind, body: { name, workTypeId: id } };
  }
}
function Composer({
  created,
  kind = 'project',
  accepted,
  stale = false,
}: {
  created: () => void;
  kind?: BlueprintPreviewRequest['kind'];
  accepted?: (value: BlueprintCreationOptions) => void;
  stale?: boolean;
}) {
  const [name, setName] = useState('Dinner');
  const [blueprint, setBlueprint] = useState<BlueprintCreationOptions | undefined>();
  const review = useBlueprintCreationReview({
    orgId: 'workspace',
    kind,
    request: () => requestFor(kind, name),
    selection: { workTypeId: id, blueprint },
    setField: (_field, options) => {
      setBlueprint(options);
      accepted?.(options);
    },
  });
  return (
    <>
      <input
        aria-label="Name"
        value={name}
        onChange={(event) => {
          setName(event.target.value);
        }}
      />
      <button
        onClick={() => {
          void review.ensureReviewed().then(async (ready) => {
            if (!ready) return;
            if (stale)
              await review.readFailure(
                Response.json(
                  {
                    type: 'about:blank',
                    title: 'Private provider diagnostic',
                    status: 409,
                    code: 'blueprint_preview_stale',
                  },
                  { status: 409 },
                ),
                'Could not create the work.',
              );
            else created();
          });
        }}
      >
        Create
      </button>
      {review.dialog}
    </>
  );
}
describe('reviewing included work in a composer', () => {
  it.each([
    { dates: { dueDate: '2026-10-20' }, unresolvedReasons: {}, expected: 'Due Oct 20, 2026' },
    {
      dates: {},
      unresolvedReasons: { dueDate: 'missing_anchor' },
      expected: 'Due: waiting for a parent or milestone date',
    },
    {
      dates: {},
      unresolvedReasons: { startDate: 'waiting_completion' },
      expected: 'Starts after prerequisite work is completed',
    },
  ])('explains the date context: $expected', async ({ dates, unresolvedReasons, expected }) => {
    const preview = fixture();
    Object.assign(preview.descendants[0] ?? {}, { dates, unresolvedReasons });
    mocks.preview.mockReset().mockResolvedValue(preview);
    render(<Composer created={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^Create$/ }));
    await screen.findByRole('dialog', { name: 'Included work' });
    expect(screen.getByText(`Task · ${expected}`)).toBeVisible();
  });
  it('uses the workspace vocabulary for included child work', async () => {
    mocks.preview.mockReset().mockResolvedValue(fixture());
    render(
      <VocabularyProvider
        skin={{ preset: 'startup', overrides: { task: { singular: 'Action', plural: 'Actions' } } }}
      >
        <Composer created={vi.fn()} />
      </VocabularyProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Create$/ }));
    await screen.findByRole('dialog', { name: 'Included work' });
    expect(screen.getByText('Action · Due Oct 20, 2026')).toBeVisible();
  });
  it('automatically reopens a stale review without clearing the authored draft or accepted choices', async () => {
    mocks.preview.mockReset().mockResolvedValue(fixture());
    const created = vi.fn();
    render(<Composer created={created} stale />);
    fireEvent.click(screen.getByRole('button', { name: /^Create$/ }));
    await screen.findByRole('dialog', { name: 'Included work' });
    fireEvent.click(screen.getByRole('button', { name: 'Keep these choices' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /^Create$/ }));
    await screen.findByRole('dialog', { name: 'Included work' });
    expect(screen.getByLabelText('Name')).toHaveValue('Dinner');
    expect(mocks.preview).toHaveBeenCalledTimes(2);
    expect(created).not.toHaveBeenCalled();
    expect(screen.queryByText('Private provider diagnostic')).not.toBeInTheDocument();
    expect(mocks.preview.mock.calls[1]?.[0]).toMatchObject({
      request: { options: { previewToken: fixture().previewToken } },
    });
  });
  it.each(['task', 'project', 'initiative', 'program'] as const)(
    'requires acceptance once for %s, then refreshes if authored root fields change',
    async (kind) => {
      mocks.preview.mockReset().mockResolvedValue(fixture());
      const created = vi.fn();
      render(<Composer created={created} kind={kind} />);
      fireEvent.click(screen.getByRole('button', { name: /^Create$/ }));
      await screen.findByRole('dialog', { name: 'Included work' });
      expect(created).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Keep these choices' }));
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^Create$/ }));
      });
      expect(created).toHaveBeenCalledTimes(1);
      expect(mocks.preview).toHaveBeenCalledTimes(1);
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Changed dinner' } });
      fireEvent.click(screen.getByRole('button', { name: /^Create$/ }));
      await screen.findByRole('dialog', { name: 'Included work' });
      expect(created).toHaveBeenCalledTimes(1);
      expect(mocks.preview).toHaveBeenCalledTimes(2);
    },
  );
  it('keeps optional choices with their reviewed token and creates only after explicit acceptance', async () => {
    mocks.preview
      .mockReset()
      .mockImplementation(async ({ request }: { request: BlueprintPreviewRequest }) => {
        const result = fixture();
        const choice = request.options?.optionalChoices?.find((item) => item.path[0] === 'prepare');
        if (choice) {
          const node = result.descendants[0];
          if (!node) throw new Error('Missing child fixture');
          node.selected = choice.selected;
          result.selectedCount = choice.selected ? 2 : 1;
        }
        return result;
      });
    const accepted = vi.fn();
    const created = vi.fn();
    render(<Composer created={created} accepted={accepted} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review included work' }));
    const checkbox = await screen.findByRole('checkbox', { name: 'Include Prepare dinner' });
    fireEvent.click(checkbox);
    await waitFor(() => {
      expect(checkbox).not.toBeChecked();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Keep these choices' }));
    expect(accepted).toHaveBeenCalledWith(
      expect.objectContaining({
        previewToken: fixture().previewToken,
        optionalChoices: [{ path: ['prepare'], selected: false }],
      }),
    );
    expect(created).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Create$/ }));
    });
    expect(created).toHaveBeenCalledTimes(1);
  });
  it('reflects an optional choice immediately while its refreshed preview is pending', async () => {
    const next = deferred<BlueprintCreationPreview>();
    mocks.preview.mockReset().mockResolvedValueOnce(fixture()).mockReturnValueOnce(next.promise);
    const accepted = vi.fn(),
      created = vi.fn();
    render(<Composer created={created} accepted={accepted} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review included work' }));
    const checkbox = await screen.findByRole('checkbox', { name: 'Include Prepare dinner' });
    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Keep these choices' })).toBeDisabled();
    expect(created).not.toHaveBeenCalled();
    const result = fixture();
    next.resolve({
      ...result,
      selectedCount: 1,
      descendants: result.descendants.map((node) => ({ ...node, selected: false })),
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Keep these choices' })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Keep these choices' }));
    expect(accepted).toHaveBeenCalledWith(
      expect.objectContaining({ optionalChoices: [{ path: ['prepare'], selected: false }] }),
    );
  });
  it('keeps the authored draft when a preview fails and displays application-owned copy', async () => {
    mocks.preview.mockReset().mockRejectedValue(new Error('Private upstream diagnostics'));
    const created = vi.fn();
    render(<Composer created={created} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review included work' }));
    await screen.findByText('Could not review included work');
    expect(screen.queryByText('Private upstream diagnostics')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep these choices' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Back to draft' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(screen.getByLabelText('Name')).toHaveValue('Dinner');
    expect(created).not.toHaveBeenCalled();
  });
});
