import { fireEvent, render, screen } from '@testing-library/react';
import type { PlanDraftOut } from '@docket/work/plan-draft-contract';
import { describe, expect, it, vi } from 'vitest';

import PlanBar, { type PlanSelectionActionsProps } from '../../src/components/plan-canvas/plan-bar';

const PLAN: PlanDraftOut = {
  id: 'plan_1',
  organizationId: 'org_1' as PlanDraftOut['organizationId'],
  sessionId: null,
  rootInitiativeId: null,
  title: 'Spring giving campaign',
  status: 'active',
  revision: 3,
  document: {
    nodes: [
      {
        ref: 'init',
        kind: 'initiative',
        parentRef: null,
        initiativeRefs: [],
        initiativeIds: [],
        fields: { title: 'Spring giving campaign' },
        templateId: null,
        status: 'draft',
        objectId: null,
      },
      {
        ref: 'p1',
        kind: 'project',
        parentRef: 'init',
        initiativeRefs: [],
        initiativeIds: [],
        fields: { title: 'Donor outreach' },
        templateId: null,
        status: 'draft',
        objectId: null,
      },
      {
        ref: 'p2',
        kind: 'project',
        parentRef: 'init',
        initiativeRefs: [],
        initiativeIds: [],
        fields: { title: 'Matching gift' },
        templateId: null,
        status: 'confirmed',
        objectId: 'prj_2',
      },
    ],
    edges: [],
  },
  objects: {
    p2: {
      name: 'Matching gift',
      statusName: 'Planned',
      health: null,
      href: '/orgs/org_1/projects/prj_2',
      archived: false,
    },
  },
  createdAt: '2026-09-12T00:00:00.000Z',
  updatedAt: '2026-09-12T00:00:00.000Z',
};

function selection(refs: readonly string[]): PlanSelectionActionsProps {
  return {
    plan: PLAN,
    refs,
    canEdit: true,
    committing: false,
    onConfirm: vi.fn(),
    onRemove: vi.fn(),
    onAsk: vi.fn(),
    onOpen: vi.fn(),
  };
}

function renderBar(refs: readonly string[], overrides: Partial<PlanSelectionActionsProps> = {}) {
  const actions = { ...selection(refs), ...overrides };
  const onToggleConversation = vi.fn();
  render(
    <PlanBar
      title="Spring giving campaign"
      navigation={<button type="button">Back</button>}
      search=""
      onSearchChange={vi.fn()}
      counts={{ projects: 2, tasks: 0, draft: 2 }}
      onAddProject={vi.fn()}
      selection={actions}
      conversationOpen={false}
      onToggleConversation={onToggleConversation}
      insetRight={0}
      onHeightChange={vi.fn()}
    />,
  );
  return { actions, onToggleConversation };
}

describe('PlanBar', () => {
  it('is the plan region with the counts while nothing is selected', () => {
    renderBar([]);
    const region = screen.getByRole('region', { name: 'Plan' });
    expect(region).toContainElement(screen.getByTestId('plan-counts'));
    expect(screen.queryByTestId('canvas-selection-bar')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add project' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search the plan' })).toBeInTheDocument();
  });

  it('swaps the counts for the selection actions and confirms the closure', () => {
    const { actions } = renderBar(['p1']);
    expect(screen.queryByTestId('plan-counts')).toBeNull();
    const group = screen.getByTestId('canvas-selection-bar');
    const confirm = screen.getByRole('button', { name: /^Confirm/ });
    expect(group).toContainElement(confirm);
    expect(confirm.title).toContain('project');
    expect(confirm.title).toContain('initiative');
    fireEvent.click(confirm);
    expect(actions.onConfirm).toHaveBeenCalledWith(['p1']);
    fireEvent.click(screen.getByRole('button', { name: /Remove/ }));
    expect(actions.onRemove).toHaveBeenCalledWith(['p1']);
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
  });

  it('offers Open for a single created node and no Remove or Confirm', () => {
    const { actions } = renderBar(['p2']);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(actions.onOpen).toHaveBeenCalledWith('/orgs/org_1/projects/prj_2');
    expect(screen.queryByRole('button', { name: /^Confirm/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
  });

  it('toggles the conversation from its pressed button', () => {
    const { onToggleConversation } = renderBar([]);
    const toggle = screen.getByRole('button', { name: /Athena/ });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(onToggleConversation).toHaveBeenCalledWith(true);
  });
});
