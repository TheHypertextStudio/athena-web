/**
 * Behavior tests for the interactive program properties panel (directive A).
 *
 * @remarks
 * A Program is ongoing, so its editable metadata is operational: owner, status, health, and
 * visibility — each an interactive picker rather than a dead row. A Program PATCH requires
 * `manage`, so the host gates `canEdit` on that capability and the panel renders read-only
 * otherwise. These tests pin: every row is a real affordance (no "Not set"), an unset owner/health
 * reads as a calm "Set <field>" prompt, choosing a value reports it to the host, and a non-manager
 * sees plain read-only text.
 *
 * Presentational + controlled: the panel takes pre-resolved options + values and reports changes
 * through typed callbacks, so these assert real behavior without the live API.
 */
import type { PickerOption } from '@docket/ui/components';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProgramPropertiesPanel } from '../../../src/components/programs/properties-panel';

afterEach(cleanup);

const MEMBER_OPTIONS: readonly PickerOption[] = [
  { value: 'actor_ada', label: 'Ada Lovelace' },
  { value: 'actor_grace', label: 'Grace Hopper' },
];

/** Choose a picker option by its label text (clicks the option's inner button). */
function chooseOption(label: RegExp | string): void {
  const option = screen.getByRole('option', { name: label });
  fireEvent.click(within(option).getByRole('button'));
}

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof ProgramPropertiesPanel>> = {},
): {
  onOwnerChange: ReturnType<typeof vi.fn>;
  onStatusChange: ReturnType<typeof vi.fn>;
  onHealthChange: ReturnType<typeof vi.fn>;
  onVisibilityChange: ReturnType<typeof vi.fn>;
} {
  const onOwnerChange = vi.fn();
  const onStatusChange = vi.fn();
  const onHealthChange = vi.fn();
  const onVisibilityChange = vi.fn();
  render(
    <ProgramPropertiesPanel
      ownerId={null}
      memberOptions={MEMBER_OPTIONS}
      status="active"
      health={null}
      visibility="public"
      canEdit
      pending={false}
      onOwnerChange={onOwnerChange}
      onStatusChange={onStatusChange}
      onHealthChange={onHealthChange}
      onVisibilityChange={onVisibilityChange}
      {...overrides}
    />,
  );
  return { onOwnerChange, onStatusChange, onHealthChange, onVisibilityChange };
}

describe('program ProgramPropertiesPanel — interactive rows (directive A)', () => {
  it('renders interactive rows with no dead "Not set" filler', () => {
    renderPanel();
    expect(screen.queryByText('Not set')).toBeNull();
    expect(screen.getByText('Set owner')).toBeTruthy();
    expect(screen.getByText('Set health')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Status — Active' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Visibility — Public' })).toBeTruthy();
  });

  it('assigns the owner through the picker', () => {
    const { onOwnerChange } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Owner — not set' }));
    chooseOption(/Ada Lovelace/);
    expect(onOwnerChange).toHaveBeenCalledWith('actor_ada');
  });

  it('pauses the program through the status enum picker', () => {
    const { onStatusChange } = renderPanel({ status: 'active' });
    fireEvent.click(screen.getByRole('button', { name: 'Status — Active' }));
    chooseOption(/Paused/);
    expect(onStatusChange).toHaveBeenCalledWith('paused');
  });

  it('switches visibility to private through the enum picker', () => {
    const { onVisibilityChange } = renderPanel({ visibility: 'public' });
    fireEvent.click(screen.getByRole('button', { name: 'Visibility — Public' }));
    chooseOption(/Private/);
    expect(onVisibilityChange).toHaveBeenCalledWith('private');
  });

  it('renders read-only (no buttons) when the actor lacks manage', () => {
    renderPanel({ ownerId: 'actor_ada', canEdit: false });
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
  });
});
