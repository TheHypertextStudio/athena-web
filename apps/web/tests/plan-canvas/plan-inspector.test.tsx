import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import type { PlanDraftOut, PlanNode } from '@docket/work/plan-draft-contract';

vi.mock('@docket/ui/components', () => ({
  DatePicker: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string | null;
    onChange: (value: string | null) => void;
    placeholder: string;
  }) => (
    <button
      type="button"
      data-testid="date-picker"
      onClick={() => {
        onChange('2026-05-20');
      }}
    >
      {value ?? placeholder}
    </button>
  ),
  ActorPicker: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string | null;
    onChange: (value: string | null) => void;
    placeholder: string;
  }) => (
    <button
      type="button"
      data-testid="actor-picker"
      onClick={() => {
        onChange('actor_2');
      }}
    >
      {value ?? placeholder}
    </button>
  ),
  EnumPicker: ({
    value,
    onChange,
    options,
    placeholder,
  }: {
    value: string | null;
    onChange: (value: string | null) => void;
    options: readonly { value: string; label: string }[];
    placeholder: string;
  }) => (
    <button
      type="button"
      data-testid="enum-picker"
      data-count={options.length}
      onClick={() => {
        onChange(options[0]?.value ?? null);
      }}
    >
      {value ?? placeholder}
    </button>
  ),
}));

vi.mock('@/components/canvas/canvas-inspector', () => ({
  CanvasInspector: ({
    title,
    children,
    onClose,
    closeLabel,
  }: {
    title: string;
    children: ReactNode;
    onClose: () => void;
    closeLabel: string;
  }) => (
    <section aria-label={title}>
      <button type="button" aria-label={closeLabel} onClick={onClose} />
      {children}
    </section>
  ),
}));

vi.mock('@/components/docket-link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/lib/query', () => ({
  useApiListQuery: () => ({
    data: { items: [{ id: 'tpl_1', name: 'Campaign', description: 'A drive' }] },
  }),
}));

vi.mock('@/components/templates/queries', () => ({
  templatesOfKindDef: () => ({}),
}));

import PlanInspector from '../../src/components/plan-canvas/plan-inspector';

function node(ref: string, overrides: Partial<PlanNode>): PlanNode {
  return {
    ref,
    kind: 'project',
    parentRef: 'init',
    initiativeRefs: [],
    initiativeIds: [],
    fields: { title: ref },
    templateId: null,
    status: 'draft',
    objectId: null,
    ...overrides,
  };
}

const PLAN: PlanDraftOut = {
  id: 'plan_1',
  organizationId: 'org_1' as PlanDraftOut['organizationId'],
  sessionId: null,
  rootInitiativeId: null,
  title: 'Spring',
  status: 'active',
  revision: 1,
  document: {
    nodes: [
      node('init', { kind: 'initiative', parentRef: null, fields: { title: 'Spring campaign' } }),
      node('p1', { fields: { title: 'Outreach', summary: 'Reach donors' } }),
      node('p2', {
        fields: { title: 'Done already' },
        status: 'confirmed',
        objectId: 'prj_2',
      }),
      node('t1', { kind: 'task', parentRef: 'p1', fields: { title: 'Segment' } }),
    ],
    edges: [],
  },
  objects: {
    p2: {
      name: 'Done already',
      statusName: 'Planned',
      health: 'on_track',
      href: '/orgs/org_1/projects/prj_2',
      archived: false,
    },
  },
  createdAt: '2026-09-05T00:00:00.000Z',
  updatedAt: '2026-09-05T00:00:00.000Z',
};

function renderInspector(
  nodeRef: string,
  overrides: Partial<Parameters<typeof PlanInspector>[0]> = {},
) {
  const onApply = vi.fn(() => Promise.resolve(null));
  const onConfirm = vi.fn();
  const onRemove = vi.fn();
  const onAsk = vi.fn();
  const onClose = vi.fn();
  render(
    <PlanInspector
      plan={PLAN}
      nodeRef={nodeRef}
      orgId="org_1"
      canEdit
      committing={false}
      memberOptions={[{ value: 'actor_2', label: 'Sam' }]}
      initiativeOptions={[{ value: 'ini_9', label: 'Brand refresh' }]}
      onApply={onApply}
      onConfirm={onConfirm}
      onRemove={onRemove}
      onAsk={onAsk}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { onApply, onConfirm, onRemove, onAsk, onClose };
}

afterEach(() => {
  cleanup();
});

describe('PlanInspector', () => {
  it('commits a retitled draft on blur as one set_fields op', () => {
    const { onApply } = renderInspector('p1');
    const title = screen.getByLabelText('Title');
    expect(title).toHaveValue('Outreach');
    fireEvent.change(title, { target: { value: 'Donor outreach' } });
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.blur(title);
    expect(onApply).toHaveBeenCalledWith([
      { op: 'set_fields', ref: 'p1', fields: { title: 'Donor outreach' } },
    ]);
  });

  it('resets on Escape and refuses a blank title', () => {
    const { onApply } = renderInspector('p1');
    const title = screen.getByLabelText('Title');
    fireEvent.change(title, { target: { value: '' } });
    fireEvent.blur(title);
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.change(title, { target: { value: 'Changed' } });
    fireEvent.keyDown(title, { key: 'Escape' });
    expect(title).toHaveValue('Outreach');
  });

  it('names what Confirm will create for a project with tasks', () => {
    const { onConfirm } = renderInspector('p1');
    const confirm = screen.getByRole('button', { name: /confirm/i });
    expect(confirm).toHaveTextContent('initiative');
    expect(confirm).toHaveTextContent('project');
    expect(confirm).toHaveTextContent('task');
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith(['p1']);
  });

  it('sets the target date through the shared date picker as one set_fields op', () => {
    const { onApply } = renderInspector('p1');
    fireEvent.click(screen.getByTestId('date-picker'));
    expect(onApply).toHaveBeenCalledWith([
      { op: 'set_fields', ref: 'p1', fields: { targetDate: '2026-05-20' } },
    ]);
  });

  it('sets the lead through the actor picker and joins an initiative through the enum picker', () => {
    const { onApply } = renderInspector('p1');
    fireEvent.click(screen.getByTestId('actor-picker'));
    expect(onApply).toHaveBeenCalledWith([
      { op: 'set_fields', ref: 'p1', fields: { leadId: 'actor_2' } },
    ]);
    const [templatePicker, initiativePicker] = screen.getAllByTestId('enum-picker');
    if (!templatePicker || !initiativePicker) throw new Error('Expected two enum pickers.');
    fireEvent.click(templatePicker);
    expect(onApply).toHaveBeenCalledWith([
      { op: 'apply_template', ref: 'p1', templateId: 'tpl_1' },
    ]);
    fireEvent.click(initiativePicker);
    expect(onApply).toHaveBeenLastCalledWith([
      expect.objectContaining({
        op: 'upsert_node',
        node: expect.objectContaining({ ref: 'p1', initiativeIds: ['ini_9'] }),
      }),
    ]);
  });

  it('shows a created node read-only with a link to its record', () => {
    const { onRemove } = renderInspector('p2');
    expect(screen.queryByLabelText('Title')).toBeNull();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/orgs/org_1/projects/prj_2');
    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull();
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('hides every write when the viewer cannot edit', () => {
    renderInspector('p1', { canEdit: false });
    expect(screen.getByLabelText('Title')).toBeDisabled();
    expect(screen.queryByRole('button', { name: /confirm/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull();
  });

  it('offers Athena and closes', () => {
    const { onAsk, onClose } = renderInspector('t1');
    fireEvent.click(screen.getByRole('button', { name: /ask athena/i }));
    expect(onAsk).toHaveBeenCalledWith('t1');
    fireEvent.click(screen.getByRole('button', { name: /close task details/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
