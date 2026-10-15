import '@testing-library/jest-dom/vitest';
import { VocabularyProvider } from '@docket/ui/hooks';
import type { TemplateOut } from '@docket/work/template-contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TemplateEditorDialog } from '@/components/templates/template-editor';

vi.mock('@/components/pickers/use-composer-options', () => ({
  useComposerOptions: () => ({
    labels: [{ id: 'label_1', name: 'Urgent' }],
    labelOptions: [{ value: 'label_1', label: 'Urgent' }],
    teamOptions: [{ value: 'team_1', label: 'Platform' }],
  }),
}));

const mutations = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));
vi.mock('@/components/templates/queries', () => ({
  useCreateTemplate: () => ({ mutateAsync: mutations.create }),
  useUpdateTemplate: () => ({ mutateAsync: mutations.update }),
}));
vi.mock('@/components/editor/freeform-text', () => ({
  FreeformTextEditor: ({
    value,
    onChange,
    disabled,
    ariaLabel,
  }: {
    value: string;
    onChange: (value: string) => void;
    disabled: boolean;
    ariaLabel: string;
  }) => (
    <textarea
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onChange={(event) => {
        onChange(event.target.value);
      }}
    />
  ),
}));
vi.mock('@/components/tasks/task-template-pickers', () => ({
  TaskTemplatePickers: ({
    priority,
    onPriorityChange,
    disabled,
  }: {
    priority: string;
    onPriorityChange: (value: string) => void;
    disabled: boolean;
  }) => (
    <select
      aria-label="Priority"
      disabled={disabled}
      value={priority}
      onChange={(event) => {
        onPriorityChange(event.target.value);
      }}
    >
      <option value="none">None</option>
      <option value="high">High</option>
    </select>
  ),
}));

const template = {
  id: 'template_1',
  name: 'Bug report',
  description: 'For defects',
  scope: 'organization',
  targetType: 'task',
  payload: { targetType: 'task', title: 'Investigate', description: '## Steps', priority: 'high' },
} as TemplateOut;

function mount(existing: TemplateOut | null = null, kind: TemplateOut['targetType'] = 'task') {
  const onOpenChange = vi.fn();
  const onSaved = vi.fn();
  const props = {
    orgId: 'org_1',
    targetType: kind,
    template: existing,
    open: true,
    onOpenChange,
    onSaved,
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<TemplateEditorDialog {...props} />, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  return { ...view, props, onOpenChange, onSaved };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Template editor', () => {
  it.each(['## Steps', ''])(
    'does not treat an editor-added final paragraph as an unsaved change for %j',
    (body) => {
      const existing: TemplateOut = {
        ...template,
        payload: { targetType: 'task', title: 'Investigate', priority: 'high', description: body },
      };
      const view = mount(existing);
      fireEvent.change(screen.getByRole('textbox', { name: 'Work description' }), {
        target: { value: `${body}\n\n` },
      });
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
      expect(view.onOpenChange).toHaveBeenCalledWith(false);
      expect(screen.queryByText('Discard this draft?')).not.toBeInTheDocument();
    },
  );

  it('creates a private guided draft through the supplied versioned writer', async () => {
    const saveDraft = vi.fn().mockResolvedValue(undefined);
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <TemplateEditorDialog
          orgId="org_1"
          targetType="project"
          template={null}
          open
          onOpenChange={vi.fn()}
          onSaved={vi.fn()}
          saveDraft={saveDraft}
        />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText('Template name'), { target: { value: 'Event' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Project name (optional)' }), {
      target: { value: 'Community dinner' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create template' }));
    await waitFor(() => {
      expect(saveDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Event',
          scope: 'personal',
          payload: expect.objectContaining({ name: 'Community dinner' }),
        }),
      );
    });
    expect(mutations.create).not.toHaveBeenCalled();
  });

  it('creates a template from Basics, Work, and the actual review values', async () => {
    mutations.create.mockResolvedValue(template);
    const view = mount();
    fireEvent.change(screen.getByLabelText('Template name'), {
      target: { value: 'Incident report' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Task title (optional)' }), {
      target: { value: 'Investigate incident' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Work description' }), {
      target: { value: '## Evidence' },
    });
    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'high' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Incident report')).toBeVisible();
    expect(screen.getByText('Investigate incident')).toBeVisible();
    expect(screen.getByText('Evidence')).toBeVisible();
    expect(screen.getByText('High')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Create template' }));
    await waitFor(() => {
      expect(mutations.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Incident report',
          payload: {
            targetType: 'task',
            title: 'Investigate incident',
            description: '## Evidence',
            priority: 'high',
          },
        }),
      );
    });
    expect(view.onSaved).toHaveBeenCalledOnce();
  });

  it('opens editing on Work and retains changes after a failed save', async () => {
    mutations.update.mockRejectedValue(new Error('provider failure'));
    mount(template);
    const title = screen.getByRole('textbox', { name: 'Task title (optional)' });
    expect(title).toHaveValue('Investigate');
    fireEvent.change(title, { target: { value: 'Investigate regression' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Could not save the template.', { exact: true });
    expect(title).toHaveValue('Investigate regression');
    expect(mutations.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: template.id,
        payload: expect.objectContaining({ title: 'Investigate regression' }),
      }),
    );
    expect(screen.queryByText('provider failure')).not.toBeInTheDocument();
  });

  it('protects metadata on close and resets after discard and reopen', () => {
    const view = mount();
    fireEvent.change(screen.getByLabelText('Template name'), { target: { value: 'Unsaved name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByText('Discard this draft?')).toBeVisible();
    expect(view.onOpenChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /^Discard$/ }));
    expect(view.onOpenChange).toHaveBeenCalledWith(false);
    view.rerender(<TemplateEditorDialog {...view.props} open={false} />);
    view.rerender(<TemplateEditorDialog {...view.props} open />);
    expect(screen.getByLabelText('Template name')).toHaveValue('');
  });

  it('protects changes to defaults even when the document is empty', () => {
    const view = mount({ ...template, payload: { targetType: 'task', priority: 'none' } });
    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'high' } });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.getByText('Discard this draft?')).toBeVisible();
    expect(view.onOpenChange).not.toHaveBeenCalled();
  });
  it('closes an unchanged existing template without asking to discard', () => {
    const view = mount(template);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(view.onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByText('Discard this draft?')).not.toBeInTheDocument();
  });

  it('protects metadata changes without changes to work defaults', () => {
    const view = mount(template);
    fireEvent.click(screen.getByRole('tab', { name: 'Basics' }));
    fireEvent.change(screen.getByLabelText('When to use it'), {
      target: { value: 'For regressions' },
    });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.getByText('Discard this draft?')).toBeVisible();
    expect(view.onOpenChange).not.toHaveBeenCalled();
  });
  it('connects each selected step to its named content panel', () => {
    mount();
    fireEvent.change(screen.getByLabelText('Template name'), {
      target: { value: 'Release checklist' },
    });
    for (const label of ['Basics', 'Work', 'Review']) {
      const tab = screen.getByRole('tab', { name: label });
      fireEvent.click(tab);
      const panel = screen.getByRole('tabpanel', { name: label });
      expect(tab).toHaveAttribute('aria-controls', panel.id);
      expect(panel).toHaveAttribute('aria-labelledby', tab.id);
      expect(tab).toHaveAttribute('aria-selected', 'true');
    }
  });
  it.each(['task', 'project', 'initiative', 'program'] as const)(
    'persists %s defaults and preserves them across steps',
    async (kind) => {
      mutations.create.mockResolvedValue(template);
      mount(null, kind);
      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
      fireEvent.change(screen.getByLabelText('Template name'), {
        target: {
          value:
            'A template with a long descriptive name for recurring work across the organization',
        },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      const workName = screen.getByRole('textbox', {
        name:
          kind === 'task'
            ? 'Task title (optional)'
            : `${kind.charAt(0).toUpperCase() + kind.slice(1)} name (optional)`,
      });
      fireEvent.change(workName, { target: { value: 'Prepare the quarterly review' } });
      fireEvent.change(screen.getByRole('textbox', { name: 'Work description' }), {
        target: { value: '## Decisions\nRecord the approved changes.' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Back' }));
      expect(screen.getByLabelText('When to use it')).toHaveValue('');
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      expect(
        screen.getByRole('textbox', {
          name:
            kind === 'task'
              ? 'Task title (optional)'
              : `${kind.charAt(0).toUpperCase() + kind.slice(1)} name (optional)`,
        }),
      ).toHaveValue('Prepare the quarterly review');
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      expect(screen.getByText('No description')).toBeVisible();
      expect(screen.getByText('Decisions')).toBeVisible();
      fireEvent.click(screen.getByRole('button', { name: 'Create template' }));
      await waitFor(() => {
        expect(mutations.create).toHaveBeenCalledWith(
          expect.objectContaining({
            targetType: kind,
            description: '',
            payload: expect.objectContaining({
              targetType: kind,
              description: '## Decisions\nRecord the approved changes.',
            }),
          }),
        );
      });
    },
  );

  it('uses workspace vocabulary for work fields', () => {
    render(
      <VocabularyProvider
        skin={{
          preset: 'startup',
          overrides: { project: { singular: 'Campaign', plural: 'Campaigns' } },
        }}
      >
        <TemplateEditorDialog
          orgId="org_1"
          targetType="project"
          template={null}
          open
          onOpenChange={vi.fn()}
          onSaved={vi.fn()}
        />
      </VocabularyProvider>,
    );
    expect(screen.getByRole('heading', { name: 'New campaign template' })).toBeVisible();
    fireEvent.change(screen.getByLabelText('Template name'), { target: { value: 'Launch' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('textbox', { name: 'Campaign name (optional)' })).toBeVisible();
  });

  it('retains team sharing and resolves label names in review', async () => {
    mutations.update.mockResolvedValue(template);
    mount({
      ...template,
      scope: 'team',
      teamId: 'team_1',
      payload: { ...template.payload, labelIds: ['label_1'] },
    } as TemplateOut);
    fireEvent.click(screen.getByRole('tab', { name: 'Review' }));
    expect(screen.getByText('Platform')).toBeVisible();
    expect(screen.getByText('Urgent')).toBeVisible();
    expect(screen.queryByText('label_1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      expect(mutations.update).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: 'team',
          teamId: 'team_1',
          payload: expect.objectContaining({ labelIds: ['label_1'] }),
        }),
      );
    });
  });

  it('renames templates without changing their stored work and restores metadata focus', async () => {
    mutations.update.mockResolvedValue(template);
    const view = mount(template);
    fireEvent.click(screen.getByRole('tab', { name: 'Basics' }));
    const name = screen.getByLabelText('Template name');
    name.focus();
    fireEvent.change(name, { target: { value: 'Regression report' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(name).toHaveFocus());
    expect(view.onOpenChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      expect(mutations.update).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Regression report', payload: template.payload }),
      );
    });
  });
  it('keeps template usage separate from work details and settings when the work name is optional', () => {
    render(
      <VocabularyProvider
        skin={{
          preset: 'startup',
          overrides: { project: { singular: 'Campaign', plural: 'Campaigns' } },
        }}
      >
        <TemplateEditorDialog
          orgId="org_1"
          targetType="project"
          template={null}
          open
          onOpenChange={vi.fn()}
          onSaved={vi.fn()}
        />
      </VocabularyProvider>,
    );
    fireEvent.change(screen.getByLabelText('Template name'), {
      target: { value: 'Client campaign' },
    });
    fireEvent.change(screen.getByLabelText('When to use it'), {
      target: { value: 'For new client engagements' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('textbox', { name: 'Campaign name (optional)' })).toBeVisible();
    expect(screen.getByRole('group', { name: 'Settings' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Campaign name (optional)' })).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('heading', { name: 'Client campaign' })).toBeVisible();
    expect(screen.getAllByText('For new client engagements')).toHaveLength(1);
    expect(screen.getAllByText('Shared with')).toHaveLength(1);
    expect(screen.getByText('Name added when you create the campaign')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Starting settings' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'No default name' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create template' })).toBeEnabled();
  });
});
