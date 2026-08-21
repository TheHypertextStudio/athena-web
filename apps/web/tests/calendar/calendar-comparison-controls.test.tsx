import '@testing-library/jest-dom/vitest';

import { OrganizationId, type OrgSummary } from '@docket/types';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CalendarComparisonControls } from '../../src/app/(app)/calendar/calendar-comparison-controls';
import { assertDefined } from '@docket/test-utils';

const WORKSPACES: readonly OrgSummary[] = [
  {
    id: OrganizationId.parse('01BX5ZZKBKACTAV9WEVGEMMVRZ'),
    name: 'Studio',
    slug: 'studio',
    isPersonal: false,
  },
];

const MEMBERS = [
  { actorId: 'actor-1', displayName: 'Ada Lovelace' },
  { actorId: 'actor-2', displayName: 'Grace Hopper' },
] as const;

afterEach(() => {
  cleanup();
});

/** Render the People control and open its popover. */
async function openPopover(
  overrides: Partial<Parameters<typeof CalendarComparisonControls>[0]> = {},
): Promise<{
  readonly onWorkspaceChange: ReturnType<typeof vi.fn>;
  readonly onActorChange: ReturnType<typeof vi.fn>;
}> {
  const onWorkspaceChange = vi.fn();
  const onActorChange = vi.fn();
  const user = userEvent.setup();
  render(
    <CalendarComparisonControls
      workspaces={WORKSPACES}
      workspaceId={assertDefined(WORKSPACES[0]).id}
      members={MEMBERS}
      selectedActorIds={['actor-1']}
      membersPending={false}
      onWorkspaceChange={onWorkspaceChange}
      onActorChange={onActorChange}
      {...overrides}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'People' }));
  await screen.findByRole('dialog', { name: 'People' });
  return { onWorkspaceChange, onActorChange };
}

describe('CalendarComparisonControls', () => {
  it('costs the toolbar one control and nothing until opened', () => {
    render(
      <CalendarComparisonControls
        workspaces={WORKSPACES}
        workspaceId={assertDefined(WORKSPACES[0]).id}
        members={MEMBERS}
        selectedActorIds={[]}
        membersPending={false}
        onWorkspaceChange={vi.fn()}
        onActorChange={vi.fn()}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'People' });
    // Shared row geometry: a 40px floor at 320px, a 44px touch target at the phone step, and a
    // compact labelled control once the row is wide enough.
    expect(trigger).toHaveClass(
      'min-h-10',
      'min-w-10',
      '@min-[22rem]:min-h-11',
      '@2xl:min-h-8',
      '@2xl:shrink-0',
    );
    expect(screen.queryByRole('combobox', { name: 'Workspace' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('changes the compared workspace from an MD3-tokenized control', async () => {
    const { onWorkspaceChange } = await openPopover();

    const workspace = screen.getByRole('combobox', { name: 'Workspace' });
    expect(workspace).toHaveAttribute('name', 'comparison-workspace');
    // The legacy `border-outline` / `bg-surface` pair is what put two token systems in one view.
    // The control now comes from the shared Select primitive, which draws its own surface — so the
    // token this asserts is the border role, not a background the primitive no longer sets.
    expect(workspace).toHaveClass('border-outline-variant');
    // Split into whole class names: a substring check cannot express this, because the
    // `border-outline-variant` asserted above contains `border-outline`, and the primitive's own
    // `hover:border-outline` is legitimate.
    expect(workspace.className.split(/\s+/)).not.toContain('border-outline');
    expect(workspace.className.split(/\s+/)).not.toContain('bg-surface');
    expect(workspace.className).not.toContain('shadow');

    fireEvent.change(workspace, { target: { value: assertDefined(WORKSPACES[0]).id } });
    expect(onWorkspaceChange).toHaveBeenCalledWith(assertDefined(WORKSPACES[0]).id);
  });

  it('gives each person an inline identity glyph and an honest selected state', async () => {
    await openPopover();

    const ada = screen.getByRole('checkbox', { name: 'Ada Lovelace' });
    const grace = screen.getByRole('checkbox', { name: 'Grace Hopper' });
    expect(ada).toHaveAttribute('aria-checked', 'true');
    expect(grace).toHaveAttribute('aria-checked', 'false');
    // The avatar is decoration beside the name, never part of the row's accessible name.
    expect(ada).toHaveTextContent('AL');
    expect(ada.className).not.toContain('border');
  });

  it('toggles a person off and on', async () => {
    const { onActorChange } = await openPopover();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Ada Lovelace' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Grace Hopper' }));

    expect(onActorChange).toHaveBeenNthCalledWith(1, 'actor-1', false);
    expect(onActorChange).toHaveBeenNthCalledWith(2, 'actor-2', true);
  });

  it('renders a named empty state when no people are available', async () => {
    await openPopover({ members: [] });

    expect(screen.getByRole('status')).toHaveTextContent('No people available.');
  });

  it('keeps the sharing explainer with the control it explains', async () => {
    await openPopover();

    expect(
      screen.getByText(/Details appear only from layers each person shared with this workspace/),
    ).toBeInTheDocument();
  });
});
