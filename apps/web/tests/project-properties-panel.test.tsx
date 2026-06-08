/**
 * Behavior tests for the interactive project properties panel (directive A).
 *
 * @remarks
 * The directive's core demand: the project detail right-rail must have NO dead read-only "Not
 * set" rows — every property is an interactive picker, an unset value reading as a calm "Set
 * <field>" affordance, and choosing a value reports the change to the host (which owns the
 * optimistic PATCH). These tests pin that contract directly on the presentational panel:
 *
 * - every property row renders a real, clickable affordance — and the literal "Not set" copy
 *   that the old dead panel showed is gone;
 * - an unset property reads as its calm "Set <field>" prompt, while a set property shows its
 *   value (the lead's name, the chosen status);
 * - choosing a value through a picker reports it to the host's `onChange`;
 * - when the actor lacks edit capability, the rows render as plain text with no button.
 *
 * The panel is presentational: it takes pre-resolved options + values and reports changes through
 * typed callbacks, so these assert real behavior without touching the live API.
 *
 * Trigger affordances carry an aria-label of the shape `"<Field> — <value|not set>"` (so assistive
 * tech announces the current value), while the visible copy is the calm "Set <field>" prompt; the
 * tests query the *visible* prompt text via `getByText` and the value via the aria-labelled button.
 * A picker option is a `<li role="option">` wrapping a `<button>`, so a selection clicks that inner
 * button.
 */
import type { PickerOption } from '@docket/ui/components';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PropertiesPanel } from '../src/components/project-detail/properties-panel';

afterEach(cleanup);

const MEMBER_OPTIONS: readonly PickerOption[] = [
  { value: 'actor_ada', label: 'Ada Lovelace' },
  { value: 'actor_grace', label: 'Grace Hopper' },
];
const PROGRAM_OPTIONS: readonly PickerOption[] = [{ value: 'prog_1', label: 'Platform' }];
const INITIATIVE_OPTIONS: readonly PickerOption[] = [{ value: 'init_1', label: 'North Star' }];

/** Choose a picker option by its label text (clicks the option's inner button). */
function chooseOption(label: RegExp | string): void {
  const option = screen.getByRole('option', { name: label });
  fireEvent.click(within(option).getByRole('button'));
}

/** Render the panel with sensible defaults, overridable per test. */
function renderPanel(overrides: Partial<React.ComponentProps<typeof PropertiesPanel>> = {}): {
  onLeadChange: ReturnType<typeof vi.fn>;
  onStatusChange: ReturnType<typeof vi.fn>;
  onHealthChange: ReturnType<typeof vi.fn>;
  onProgramChange: ReturnType<typeof vi.fn>;
} {
  const onLeadChange = vi.fn();
  const onStatusChange = vi.fn();
  const onHealthChange = vi.fn();
  const onTimelineChange = vi.fn();
  const onProgramChange = vi.fn();
  const onInitiativeChange = vi.fn();
  render(
    <PropertiesPanel
      leadId={null}
      memberOptions={MEMBER_OPTIONS}
      status="planned"
      health={null}
      startDate={null}
      targetDate={null}
      programId={null}
      programOptions={PROGRAM_OPTIONS}
      initiativeId={null}
      initiativeOptions={INITIATIVE_OPTIONS}
      canEdit
      pending={false}
      onLeadChange={onLeadChange}
      onStatusChange={onStatusChange}
      onHealthChange={onHealthChange}
      onTimelineChange={onTimelineChange}
      onProgramChange={onProgramChange}
      onInitiativeChange={onInitiativeChange}
      {...overrides}
    />,
  );
  return { onLeadChange, onStatusChange, onHealthChange, onProgramChange };
}

describe('project PropertiesPanel — interactive rows (directive A)', () => {
  it('renders no dead "Not set" rows; unset rows are calm "Set <field>" affordances', () => {
    renderPanel();

    // The old dead-panel copy must be gone entirely.
    expect(screen.queryByText('Not set')).toBeNull();

    // Each unset property shows a calm "Set <field>" prompt (the visible button text).
    expect(screen.getByText('Set lead')).toBeTruthy();
    expect(screen.getByText('Set health')).toBeTruthy();
    expect(screen.getByText('Set timeline')).toBeTruthy();
    // Status defaults to 'planned' (non-nullable), so it shows the value, not a prompt.
    expect(screen.getByRole('button', { name: 'Status — Planned' })).toBeTruthy();
  });

  it('shows a set property as its value (lead name, status)', () => {
    renderPanel({ leadId: 'actor_ada', status: 'active' });

    expect(screen.getByRole('button', { name: 'Lead — Ada Lovelace' })).toBeTruthy();
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Status — Active' })).toBeTruthy();
  });

  it('assigns a lead through the picker and reports it to the host', () => {
    const { onLeadChange } = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Lead — not set' }));
    chooseOption(/Grace Hopper/);

    expect(onLeadChange).toHaveBeenCalledWith('actor_grace');
  });

  it('changes the project status through the enum picker', () => {
    const { onStatusChange } = renderPanel({ status: 'planned' });

    fireEvent.click(screen.getByRole('button', { name: 'Status — Planned' }));
    chooseOption(/Completed/);

    expect(onStatusChange).toHaveBeenCalledWith('completed');
  });

  it('clears the health verdict through the picker "clear" row', () => {
    const { onHealthChange } = renderPanel({ health: 'at_risk' });

    fireEvent.click(screen.getByRole('button', { name: 'Health — At risk' }));
    fireEvent.click(screen.getByRole('button', { name: 'No health' }));

    expect(onHealthChange).toHaveBeenCalledWith(null);
  });

  it('attaches a program through the entity picker', () => {
    const { onProgramChange } = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Program — not set' }));
    chooseOption(/Platform/);

    expect(onProgramChange).toHaveBeenCalledWith('prog_1');
  });

  it('renders read-only plain text (no buttons) when the actor cannot edit', () => {
    renderPanel({ leadId: 'actor_ada', canEdit: false });

    // No interactive affordances at all when read-only.
    expect(screen.queryByRole('button')).toBeNull();
    // The value still reads (the panel stays complete), and there is no "Not set" filler.
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    expect(screen.queryByText('Not set')).toBeNull();
  });

  it('disables the pickers while a mutation is in flight', () => {
    renderPanel({ pending: true });

    const leadTrigger = screen.getByRole('button', { name: 'Lead — not set' });
    expect(leadTrigger.hasAttribute('disabled')).toBe(true);
    // A disabled trigger does not open the listbox.
    fireEvent.click(leadTrigger);
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('keeps every property settable: each unset row offers a "Set …" prompt', () => {
    // A panel where everything is unset must offer a "Set …" prompt for every property,
    // guarding against any future regression that reintroduces a dead row for one of them.
    renderPanel();
    for (const field of [
      'Set lead',
      'Set health',
      'Set timeline',
      'Set program',
      'Set initiative',
    ]) {
      expect(screen.getByText(field)).toBeTruthy();
    }
  });
});
