import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ActorPicker } from '../../../src/components/pickers/ActorPicker';
import { DatePicker, DateRangePicker } from '../../../src/components/pickers/DatePicker';
import { EntityPicker } from '../../../src/components/pickers/EntityPicker';
import { EnumPicker } from '../../../src/components/pickers/EnumPicker';
import { LabelsPicker } from '../../../src/components/pickers/LabelsPicker';
import { OptionPicker } from '../../../src/components/pickers/OptionPicker';
import { PickerList } from '../../../src/components/pickers/PickerList';
import { PropertyTrigger } from '../../../src/components/pickers/PropertyTrigger';
import { optionMatches, type PickerOption } from '../../../src/components/pickers/types';

const ACTORS: PickerOption[] = [
  { value: 'a1', label: 'Ada Lovelace', keywords: ['ada@calc.org'] },
  { value: 'a2', label: 'Grace Hopper' },
  { value: 'a3', label: 'Alan Turing', disabled: true },
];

const PROJECTS: PickerOption[] = [
  { value: 'p1', label: 'Migration', hint: '12' },
  { value: 'p2', label: 'Onboarding' },
];

describe('optionMatches', () => {
  it('matches everything on an empty query', () => {
    expect(optionMatches(ACTORS[0]!, '')).toBe(true);
  });

  it('matches against the label, case-insensitively', () => {
    expect(optionMatches({ value: 'x', label: 'Migration' }, 'migr')).toBe(true);
    expect(optionMatches({ value: 'x', label: 'Migration' }, 'zzz')).toBe(false);
  });

  it('matches against hidden keywords', () => {
    expect(optionMatches(ACTORS[0]!, 'calc.org')).toBe(true);
  });
});

describe('PropertyTrigger', () => {
  it('shows the value (icon + label) when set', () => {
    render(
      <PropertyTrigger
        icon={<span data-testid="glyph" />}
        label="Ada Lovelace"
        placeholder="Set lead"
      />,
    );
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByTestId('glyph')).toBeInTheDocument();
    expect(screen.queryByText('Set lead')).not.toBeInTheDocument();
  });

  it('shows the calm "Set <field>" prompt — never dead filler — when unset', () => {
    render(<PropertyTrigger placeholder="Set lead" />);
    expect(screen.getByText('Set lead')).toBeInTheDocument();
    // It is an interactive affordance (a button), not static "Not set" text.
    expect(screen.getByRole('button')).toBeEnabled();
  });

  it('renders plain, non-interactive text when readOnly with a value', () => {
    render(<PropertyTrigger label="Ada Lovelace" placeholder="Set lead" readOnly />);
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders a muted em-dash when readOnly and unset', () => {
    render(<PropertyTrigger placeholder="Set lead" readOnly />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('disables the trigger when disabled', () => {
    render(<PropertyTrigger placeholder="Set lead" disabled />);
    expect(screen.getByRole('button')).toBeDisabled();
  });
});

describe('PickerList', () => {
  it('renders every option with its hint and filters on search', () => {
    render(
      <PickerList options={PROJECTS} selected={null} onSelect={vi.fn()} ariaLabel="Project" />,
    );
    expect(screen.getByRole('option', { name: /Migration/ })).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search Project'), { target: { value: 'onb' } });
    expect(screen.queryByRole('option', { name: /Migration/ })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Onboarding/ })).toBeInTheDocument();
  });

  it('shows the empty text when nothing matches', () => {
    render(
      <PickerList
        options={PROJECTS}
        selected={null}
        onSelect={vi.fn()}
        emptyText="No projects"
        ariaLabel="Project"
      />,
    );
    fireEvent.change(screen.getByLabelText('Search Project'), { target: { value: 'zzzz' } });
    expect(screen.getByText('No projects')).toBeInTheDocument();
  });

  it('reports the chosen value on click', () => {
    const onSelect = vi.fn();
    render(
      <PickerList options={PROJECTS} selected={null} onSelect={onSelect} ariaLabel="Project" />,
    );
    fireEvent.click(within(screen.getByRole('option', { name: /Migration/ })).getByRole('button'));
    expect(onSelect).toHaveBeenCalledWith('p1');
  });

  it('does not report a disabled option', () => {
    const onSelect = vi.fn();
    render(
      <PickerList options={ACTORS} selected={null} onSelect={onSelect} ariaLabel="Assignee" />,
    );
    const disabled = within(screen.getByRole('option', { name: /Alan Turing/ })).getByRole(
      'button',
    );
    expect(disabled).toBeDisabled();
    fireEvent.click(disabled);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('marks the selected option and supports multi-select', () => {
    render(
      <PickerList
        options={PROJECTS}
        selected={['p1']}
        onSelect={vi.fn()}
        multiple
        ariaLabel="Project"
      />,
    );
    expect(screen.getByRole('option', { name: /Migration/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('option', { name: /Onboarding/ })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    expect(screen.getByRole('listbox')).toHaveAttribute('aria-multiselectable', 'true');
  });

  it('activates the keyboard-highlighted row on Enter (arrow navigation)', () => {
    const onSelect = vi.fn();
    render(
      <PickerList options={PROJECTS} selected={null} onSelect={onSelect} ariaLabel="Project" />,
    );
    const search = screen.getByLabelText('Search Project');
    // Start at index 0 (Migration); ArrowDown → Onboarding; Enter selects it.
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('p2');
  });

  it('renders and invokes a clear row', () => {
    const onClear = vi.fn();
    render(
      <PickerList
        options={PROJECTS}
        selected="p1"
        onSelect={vi.fn()}
        clear={{ label: 'No project', onClear }}
        ariaLabel="Project"
      />,
    );
    fireEvent.click(screen.getByText('No project'));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('hides the search input when not searchable and navigates on the listbox', () => {
    const onSelect = vi.fn();
    render(
      <PickerList
        options={PROJECTS}
        selected={null}
        onSelect={onSelect}
        searchable={false}
        ariaLabel="Project"
      />,
    );
    expect(screen.queryByLabelText('Search Project')).not.toBeInTheDocument();
    const listbox = screen.getByRole('listbox');
    fireEvent.keyDown(listbox, { key: 'End' });
    fireEvent.keyDown(listbox, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('p2');
  });
});

describe('OptionPicker', () => {
  it('opens the popover from the trigger and reports a selection, then closes', async () => {
    const onChange = vi.fn();
    function Host(): React.JSX.Element {
      const [value, setValue] = useState<string | null>(null);
      return (
        <OptionPicker
          options={PROJECTS}
          value={value}
          onChange={(next) => {
            setValue(next);
            onChange(next);
          }}
          placeholder="Set project"
          ariaLabel="Project"
        />
      );
    }
    render(<Host />);

    fireEvent.click(screen.getByRole('button', { name: /Project — not set/ }));
    const option = await screen.findByRole('option', { name: /Onboarding/ });
    fireEvent.click(within(option).getByRole('button'));

    expect(onChange).toHaveBeenCalledWith('p2');
    await waitFor(() => {
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
  });

  it('reports null when the clear row is chosen', async () => {
    const onChange = vi.fn();
    render(
      <OptionPicker
        options={PROJECTS}
        value="p1"
        onChange={onChange}
        placeholder="Set project"
        clearLabel="No project"
        ariaLabel="Project"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Project — Migration/ }));
    fireEvent.click(await screen.findByText('No project'));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('renders read-only with no opener', () => {
    render(
      <OptionPicker
        options={PROJECTS}
        value="p1"
        onChange={vi.fn()}
        placeholder="Set project"
        ariaLabel="Project"
        readOnly
      />,
    );
    expect(screen.getByText('Migration')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('EnumPicker', () => {
  const STATUS: PickerOption[] = [
    { value: 'planned', label: 'Planned' },
    { value: 'active', label: 'Active' },
    { value: 'completed', label: 'Completed' },
  ];

  it('shows the current value and reports a new enum choice', async () => {
    const onChange = vi.fn();
    render(
      <EnumPicker
        options={STATUS}
        value="planned"
        onChange={onChange}
        placeholder="Set status"
        ariaLabel="Status"
      />,
    );
    expect(screen.getByText('Planned')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Status — Planned/ }));
    const active = await screen.findByRole('option', { name: /Active/ });
    fireEvent.click(within(active).getByRole('button'));
    expect(onChange).toHaveBeenCalledWith('active');
  });
});

describe('ActorPicker', () => {
  it('searches the roster and reports the chosen actor id', async () => {
    const onChange = vi.fn();
    render(<ActorPicker options={ACTORS} value={null} onChange={onChange} ariaLabel="Assignee" />);
    fireEvent.click(screen.getByRole('button', { name: /Assignee — not set/ }));
    fireEvent.change(await screen.findByLabelText('Search Assignee'), {
      target: { value: 'grace' },
    });
    fireEvent.click(
      within(screen.getByRole('option', { name: /Grace Hopper/ })).getByRole('button'),
    );
    expect(onChange).toHaveBeenCalledWith('a2');
  });
});

describe('EntityPicker', () => {
  it('reports null when cleared from a set entity', async () => {
    const onChange = vi.fn();
    render(
      <EntityPicker
        options={PROJECTS}
        value="p2"
        onChange={onChange}
        placeholder="Set project"
        clearLabel="No project"
        ariaLabel="Project"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Project — Onboarding/ }));
    fireEvent.click(await screen.findByText('No project'));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

describe('LabelsPicker', () => {
  const LABELS: PickerOption[] = [
    { value: 'l1', label: 'bug' },
    { value: 'l2', label: 'feature' },
    { value: 'l3', label: 'chore' },
  ];

  it('summarizes a single selection by name and several as a count', () => {
    const { rerender } = render(
      <LabelsPicker options={LABELS} value={['l1']} onToggle={vi.fn()} />,
    );
    expect(screen.getByText('bug')).toBeInTheDocument();
    rerender(<LabelsPicker options={LABELS} value={['l1', 'l2']} onToggle={vi.fn()} />);
    expect(screen.getByText('2 labels')).toBeInTheDocument();
  });

  it('shows the calm prompt when empty', () => {
    render(<LabelsPicker options={LABELS} value={[]} onToggle={vi.fn()} />);
    expect(screen.getByText('Add labels')).toBeInTheDocument();
  });

  it('toggles a label and keeps the popover open for multiple picks', async () => {
    const onToggle = vi.fn();
    render(<LabelsPicker options={LABELS} value={['l1']} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: /Labels — bug/ }));
    const listbox = await screen.findByRole('listbox');
    fireEvent.click(
      within(within(listbox).getByRole('option', { name: /feature/ })).getByRole('button'),
    );
    expect(onToggle).toHaveBeenCalledWith('l2');
    // The popover stays open so the user can pick more.
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });
});

describe('DatePicker', () => {
  it('shows a formatted date and reports a new ISO date', async () => {
    const onChange = vi.fn();
    render(
      <DatePicker
        value="2026-03-15"
        onChange={onChange}
        placeholder="Set due date"
        ariaLabel="Due date"
      />,
    );
    // Default format renders a short locale day, not the raw ISO string.
    expect(screen.queryByText('2026-03-15')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Due date —/ }));
    const field = await screen.findByLabelText('Due date');
    fireEvent.change(field, { target: { value: '2026-04-01' } });
    expect(onChange).toHaveBeenCalledWith('2026-04-01');
  });

  it('clears to null and uses the calm prompt when unset', async () => {
    const onChange = vi.fn();
    render(
      <DatePicker
        value="2026-03-15"
        onChange={onChange}
        placeholder="Set due date"
        ariaLabel="Due date"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Due date —/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Clear' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('renders read-only with an em-dash when unset', () => {
    render(
      <DatePicker
        value={null}
        onChange={vi.fn()}
        placeholder="Set due date"
        ariaLabel="Due date"
        readOnly
      />,
    );
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('DateRangePicker', () => {
  it('summarizes both bounds and reports a changed start', async () => {
    const onChange = vi.fn();
    render(
      <DateRangePicker
        value={{ start: '2026-01-01', end: '2026-02-01' }}
        onChange={onChange}
        placeholder="Set timeline"
        ariaLabel="Timeline"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Timeline —/ }));
    fireEvent.change(await screen.findByLabelText('Timeline Start'), {
      target: { value: '2026-01-15' },
    });
    expect(onChange).toHaveBeenCalledWith({ start: '2026-01-15', end: '2026-02-01' });
  });

  it('shows the calm prompt when neither bound is set', () => {
    render(
      <DateRangePicker
        value={{ start: null, end: null }}
        onChange={vi.fn()}
        placeholder="Set timeline"
        ariaLabel="Timeline"
      />,
    );
    expect(screen.getByText('Set timeline')).toBeInTheDocument();
  });
});
