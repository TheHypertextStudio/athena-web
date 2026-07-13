import '@testing-library/jest-dom/vitest';

import { OrganizationId, type OrgSummary } from '@docket/types';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CalendarComparisonControls } from '../../src/app/(app)/calendar/calendar-comparison-controls';

const WORKSPACES: readonly OrgSummary[] = [
  {
    id: OrganizationId.parse('01BX5ZZKBKACTAV9WEVGEMMVRZ'),
    name: 'Studio',
    slug: 'studio',
    isPersonal: false,
  },
];

afterEach(() => {
  cleanup();
});

describe('CalendarComparisonControls', () => {
  it('names comparison form controls and exposes visible interaction states', () => {
    render(
      <CalendarComparisonControls
        workspaces={WORKSPACES}
        workspaceId={WORKSPACES[0]!.id}
        members={[{ actorId: 'actor-1', displayName: 'Ada Lovelace' }]}
        selectedActorIds={['actor-1']}
        membersPending={false}
        onWorkspaceChange={vi.fn()}
        onActorChange={vi.fn()}
      />,
    );

    const workspace = screen.getByRole('combobox', { name: 'Workspace' });
    expect(workspace).toHaveAttribute('name', 'comparison-workspace');
    expect(workspace).toHaveClass('focus-visible:ring-2');

    const actor = screen.getByRole('checkbox', { name: 'Ada Lovelace' });
    expect(actor).toHaveAttribute('name', 'comparison-actors');
    expect(actor).toHaveAttribute('value', 'actor-1');
    expect(actor.closest('label')).toHaveClass(
      'hover:bg-surface-container-high',
      'focus-within:ring-2',
      'transition-colors',
      'motion-reduce:transition-none',
    );
  });

  it('renders a named empty state when no people are available', () => {
    render(
      <CalendarComparisonControls
        workspaces={WORKSPACES}
        workspaceId={WORKSPACES[0]!.id}
        members={[]}
        selectedActorIds={[]}
        membersPending={false}
        onWorkspaceChange={vi.fn()}
        onActorChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('No people available.');
  });
});
