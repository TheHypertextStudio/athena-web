import { fireEvent, render, screen } from '@testing-library/react';
import type { Editor } from '@tiptap/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useComposerTemplateContribution } from '@/components/composer/use-template-contribution';

const mocks = vi.hoisted(() => ({ automatic: false }));
const publication = {
  id: 'event',
  targetType: 'task',
  scope: 'organization',
  offeredTeamIds: [],
  latestVersion: { id: 'v1' },
  definition: {
    name: 'Event',
    defaultStatusKey: 'doing',
    payload: { targetType: 'task', description: 'Outline', priority: 'low', labelIds: ['B'] },
  },
};
vi.mock('@/components/templates/work-template-queries', () => ({
  workTemplatesDef: () => ({ queryKey: ['definitions'] }),
}));
vi.mock('@/components/statuses/queries', () => ({
  statusSetsDef: () => ({ queryKey: ['statuses'] }),
}));
vi.mock('@/lib/query', () => ({
  useApiQuery: (options: { queryKey: unknown[] }) => ({
    isSuccess: true,
    data: {
      items: options.queryKey.includes('definitions')
        ? [publication]
        : [
            {
              entityType: 'task',
              teamId: null,
              statuses: [
                { key: 'todo', name: 'To do', isDefault: true },
                { key: 'doing', name: 'Doing', isDefault: false },
              ],
            },
          ],
    },
  }),
}));
vi.mock('@/components/composer/work-template-picker', () => ({
  WorkTemplatePicker: ({ onSelect }: { onSelect: (value: unknown, status: string) => void }) => (
    <button
      onClick={() => {
        onSelect(publication, 'doing');
      }}
    >
      Choose Event
    </button>
  ),
}));
vi.mock('@/components/composer/template-menu', () => ({
  ComposerTemplateControl: ({
    onApply,
  }: {
    onApply: (value: unknown, automatic: boolean) => void;
  }) => (
    <button
      onClick={() => {
        onApply(
          {
            id: 'event',
            scope: 'organization',
            workTypeVersionId: 'v1',
            payload: publication.definition.payload,
          },
          mocks.automatic,
        );
      }}
    >
      Inline Event
    </button>
  ),
}));

function Composer(): React.JSX.Element {
  const [draft, setDraft] = useState({
    title: 'My title',
    description: 'My notes',
    priority: 'high',
    labelIds: ['A'],
    state: 'todo',
    dueDate: '2026-10-20',
  });
  const contribution = useComposerTemplateContribution({
    kind: 'task',
    orgId: 'org',
    open: true,
    destinationReady: true,
    host: undefined,
    contextualDefaultsApply: true,
    defaultTemplateId: null,
    resumeDraftId: null,
    teamId: null,
    creating: false,
    onOpenChange: vi.fn(),
    updateDraft: (recipe) => {
      setDraft((current) => ({ ...current, ...recipe(current) }));
    },
    patch: (payload) => payload,
    rule: { document: 'description', labels: ['title'] },
  });
  return (
    <>
      {contribution.selection}
      {contribution.renderEmptyAction?.({} as Editor)}
      <output>{JSON.stringify(draft)}</output>
    </>
  );
}

describe('template field ownership during creation', () => {
  it('keeps authored properties and dates when only identity is selected', () => {
    mocks.automatic = false;
    render(<Composer />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose Event' }));
    expect(screen.getByRole('status', { hidden: true })).toHaveTextContent('My notes');
    fireEvent.click(screen.getByRole('button', { name: 'Keep current fields' }));
    expect(screen.getByRole('status')).toHaveTextContent('"priority":"high"');
    expect(screen.getByRole('status')).toHaveTextContent('"labelIds":["A"]');
    expect(screen.getByRole('status')).toHaveTextContent('"state":"todo"');
    expect(screen.getByRole('status')).toHaveTextContent('"workTypeId":"event"');
  });
  it('applies fields only after confirmation, appending prose and preserving dates', () => {
    mocks.automatic = false;
    render(<Composer />);
    fireEvent.click(screen.getByRole('button', { name: 'Inline Event' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply starting fields' }));
    expect(screen.getByRole('status')).toHaveTextContent('My notes\\n\\nOutline');
    expect(screen.getByRole('status')).toHaveTextContent('"priority":"low"');
    expect(screen.getByRole('status')).toHaveTextContent('"labelIds":["B"]');
    expect(screen.getByRole('status')).toHaveTextContent('"state":"doing"');
    expect(screen.getByRole('status')).toHaveTextContent('2026-10-20');
  });
  it('uses canonical status defaults for an automatic command launch', () => {
    mocks.automatic = true;
    render(<Composer />);
    fireEvent.click(screen.getByRole('button', { name: 'Inline Event' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('"state":"doing"');
  });
});
