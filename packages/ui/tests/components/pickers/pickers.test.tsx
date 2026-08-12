import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ActorPicker } from '../../../src/components/pickers/ActorPicker';
import { CalendarGrid } from '../../../src/components/pickers/CalendarGrid';
import { DatePicker, DateRangePicker } from '../../../src/components/pickers/DatePicker';
import { EntityMultiPicker } from '../../../src/components/pickers/EntityMultiPicker';
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

  it('shows the leading icon alongside the value when readOnly', () => {
    render(
      <PropertyTrigger
        icon={<span data-testid="ro-glyph" />}
        label="Ada Lovelace"
        placeholder="Set lead"
        readOnly
      />,
    );
    expect(screen.getByTestId('ro-glyph')).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('omits the leading + on the empty prompt when hidePlaceholderIcon is set', () => {
    const { container } = render(<PropertyTrigger placeholder="Set lead" hidePlaceholderIcon />);
    expect(container.querySelector('svg')).not.toBeInTheDocument();
    expect(screen.getByText('Set lead')).toBeInTheDocument();
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

  it('reports typing without giving up filtering', () => {
    // Owning the query text and owning the filtering are independent. A caller lifting the term
    // into URL state, or clearing it when a popover closes, must not silently lose local matching.
    const onQueryChange = vi.fn();
    render(
      <PickerList
        options={PROJECTS}
        selected={null}
        onSelect={vi.fn()}
        query="onb"
        onQueryChange={onQueryChange}
        ariaLabel="Project"
      />,
    );
    expect(screen.queryByRole('option', { name: /Migration/ })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Onboarding/ })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search Project'), { target: { value: 'mig' } });
    expect(onQueryChange).toHaveBeenCalledWith('mig');
  });

  it('leaves an already-filtered list alone when told the caller filtered it', () => {
    // A server interpreted the query its own way; re-running `includes` over the answer would
    // drop rows it deliberately returned.
    render(
      <PickerList
        options={PROJECTS}
        selected={null}
        onSelect={vi.fn()}
        query="zzzz"
        onQueryChange={vi.fn()}
        filter="none"
        ariaLabel="Project"
      />,
    );
    expect(screen.getByRole('option', { name: /Migration/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Onboarding/ })).toBeInTheDocument();
  });

  it('shows placeholder rows while loading rather than claiming no matches', () => {
    // The one thing a search box must never do is report absence before it has an answer.
    render(
      <PickerList
        options={[]}
        selected={null}
        onSelect={vi.fn()}
        query="mig"
        onQueryChange={vi.fn()}
        loading
        emptyText="No projects"
        ariaLabel="Project"
      />,
    );
    expect(screen.queryByText('No projects')).not.toBeInTheDocument();
    expect(screen.getByRole('listbox', { name: 'Project' })).toHaveAttribute('aria-busy', 'true');
  });

  it('distinguishes "nothing here yet" from "nothing matched"', () => {
    // Different problems with different fixes: the first usually needs an action from the reader,
    // the second just needs a shorter query.
    const view = render(
      <PickerList
        options={[]}
        selected={null}
        onSelect={vi.fn()}
        query=""
        onQueryChange={vi.fn()}
        idleText="Nothing shared yet"
        emptyText="No projects"
        ariaLabel="Project"
      />,
    );
    expect(screen.getByText('Nothing shared yet')).toBeInTheDocument();

    view.rerender(
      <PickerList
        options={[]}
        selected={null}
        onSelect={vi.fn()}
        query="zzz"
        onQueryChange={vi.fn()}
        idleText="Nothing shared yet"
        emptyText="No projects"
        ariaLabel="Project"
      />,
    );
    expect(screen.getByText('No projects')).toBeInTheDocument();
  });

  it('falls back to the empty text when no idle text is given', () => {
    // The uncontrolled path must be untouched: one string, exactly as before.
    render(
      <PickerList
        options={[]}
        selected={null}
        onSelect={vi.fn()}
        emptyText="No projects"
        ariaLabel="Project"
      />,
    );
    expect(screen.getByText('No projects')).toBeInTheDocument();
    expect(screen.getByRole('listbox', { name: 'Project' })).not.toHaveAttribute('aria-busy');
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

  it('falls back to a plain "Search" label when no ariaLabel is given', () => {
    render(<PickerList options={PROJECTS} selected={null} onSelect={vi.fn()} />);
    expect(screen.getByLabelText('Search')).toBeInTheDocument();
  });

  it('renders an option icon and supporting text when supplied', () => {
    const options: PickerOption[] = [
      {
        value: 'p1',
        label: 'Migration',
        icon: <span data-testid="opt-icon" />,
        supporting: 'Owned by Platform',
      },
    ];
    render(<PickerList options={options} selected={null} onSelect={vi.fn()} ariaLabel="Project" />);
    expect(screen.getByTestId('opt-icon')).toBeInTheDocument();
    expect(screen.getByText('Owned by Platform')).toBeInTheDocument();
  });

  it('gives the chosen row the same tertiary-container selection role a checked menu item uses', () => {
    render(<PickerList options={PROJECTS} selected="p1" onSelect={vi.fn()} ariaLabel="Project" />);
    const chosen = within(screen.getByRole('option', { name: /Migration/ })).getByRole('button');
    expect(chosen).toHaveClass('bg-tertiary-container', 'text-on-tertiary-container');
    const unchosen = within(screen.getByRole('option', { name: /Onboarding/ })).getByRole('button');
    expect(unchosen).not.toHaveClass('bg-tertiary-container');
  });

  it('reserves the leading-icon column for every row once any option in the list has one', () => {
    const options: PickerOption[] = [
      { value: 'p1', label: 'Migration', icon: <span data-testid="opt-icon" /> },
      { value: 'p2', label: 'Onboarding' },
    ];
    render(<PickerList options={options} selected={null} onSelect={vi.fn()} ariaLabel="Project" />);
    // The icon-bearing row renders its glyph…
    expect(screen.getByTestId('opt-icon')).toBeInTheDocument();
    // …and the icon-less sibling still gets the reserved gutter span, so both labels share one
    // left axis instead of the bare row starting flush with the container edge.
    const bareRow = within(screen.getByRole('option', { name: /Onboarding/ })).getByRole('button');
    expect(bareRow.querySelector('span[aria-hidden="true"]')).toBeInTheDocument();
  });

  it('omits the leading-icon gutter entirely when no option in the list has an icon', () => {
    render(
      <PickerList options={PROJECTS} selected={null} onSelect={vi.fn()} ariaLabel="Project" />,
    );
    const row = within(screen.getByRole('option', { name: /Migration/ })).getByRole('button');
    expect(row.querySelector('span[aria-hidden="true"]')).not.toBeInTheDocument();
  });

  it('moves the highlight up with ArrowUp, clamped at the first row', () => {
    const onSelect = vi.fn();
    render(
      <PickerList options={PROJECTS} selected={null} onSelect={onSelect} ariaLabel="Project" />,
    );
    const search = screen.getByLabelText('Search Project');
    fireEvent.keyDown(search, { key: 'ArrowDown' }); // -> Onboarding (index 1)
    fireEvent.keyDown(search, { key: 'ArrowUp' }); // -> back to Migration (index 0)
    fireEvent.keyDown(search, { key: 'ArrowUp' }); // clamped at 0
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('p1');
  });

  it('jumps to the first row with Home', () => {
    const onSelect = vi.fn();
    render(
      <PickerList options={PROJECTS} selected={null} onSelect={onSelect} ariaLabel="Project" />,
    );
    const search = screen.getByLabelText('Search Project');
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Home' });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('p1');
  });

  it('ignores an unrelated key', () => {
    const onSelect = vi.fn();
    render(
      <PickerList options={PROJECTS} selected={null} onSelect={onSelect} ariaLabel="Project" />,
    );
    fireEvent.keyDown(screen.getByLabelText('Search Project'), { key: 'Tab' });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('does not throw when Enter is pressed with zero matching rows', () => {
    const onSelect = vi.fn();
    render(
      <PickerList options={PROJECTS} selected={null} onSelect={onSelect} ariaLabel="Project" />,
    );
    const search = screen.getByLabelText('Search Project');
    fireEvent.change(search, { target: { value: 'zzzz' } });
    expect(() => {
      fireEvent.keyDown(search, { key: 'Enter' });
    }).not.toThrow();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('highlights an unchosen row and the clear row on mouse hover', () => {
    render(
      <PickerList
        options={PROJECTS}
        selected="p1"
        onSelect={vi.fn()}
        clear={{ label: 'No project', onClear: vi.fn() }}
        ariaLabel="Project"
      />,
    );
    // Onboarding (p2) is not the selected value. The keyboard-highlighted row is the focus
    // state, so it takes the spec's 10% layer; pointer hover alone is the 8% one.
    const onboardingOption = screen.getByRole('option', { name: /Onboarding/ });
    fireEvent.mouseEnter(within(onboardingOption).getByRole('button'));
    expect(within(onboardingOption).getByRole('button')).toHaveClass('bg-on-surface/10');

    fireEvent.mouseEnter(screen.getByText('No project'));
    expect(screen.getByText('No project').closest('button')).toHaveClass('bg-on-surface/10');
  });

  it('keeps the chosen row on its selection color instead of the hover overlay while highlighted', () => {
    render(<PickerList options={PROJECTS} selected="p1" onSelect={vi.fn()} ariaLabel="Project" />);
    const migrationOption = screen.getByRole('option', { name: /Migration/ });
    const button = within(migrationOption).getByRole('button');
    fireEvent.mouseEnter(button);
    expect(button).toHaveClass('bg-tertiary-container');
    expect(button).not.toHaveClass('bg-on-surface/10');
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

  it('renders without an accessible-label prefix when ariaLabel is omitted', () => {
    render(
      <OptionPicker options={PROJECTS} value={null} onChange={vi.fn()} placeholder="Set project" />,
    );
    // No ariaLabel means no explicit aria-label attribute; the button falls back to its text.
    const trigger = screen.getByRole('button', { name: 'Set project' });
    expect(trigger).not.toHaveAttribute('aria-label');
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

  it('falls back to "1 label" when the single selected value no longer matches an option', () => {
    render(<LabelsPicker options={LABELS} value={['stale-id']} onToggle={vi.fn()} />);
    expect(screen.getByText('1 label')).toBeInTheDocument();
  });

  it('renders read-only with no opener', () => {
    render(<LabelsPicker options={LABELS} value={['l1']} onToggle={vi.fn()} readOnly />);
    expect(screen.getByText('bug')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('EntityMultiPicker', () => {
  const PROJECTS_MULTI: PickerOption[] = [
    { value: 'p1', label: 'Migration' },
    { value: 'p2', label: 'Onboarding' },
  ];

  it('shows the calm prompt when empty and reports a toggle', async () => {
    const onToggle = vi.fn();
    render(
      <EntityMultiPicker
        options={PROJECTS_MULTI}
        value={[]}
        onToggle={onToggle}
        placeholder="Add projects"
        singularLabel="project"
        pluralLabel="projects"
        ariaLabel="Projects"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Projects — none/ }));
    const option = await screen.findByRole('option', { name: /Migration/ });
    fireEvent.click(within(option).getByRole('button'));
    expect(onToggle).toHaveBeenCalledWith('p1');
  });

  it('summarizes a single selection by name and several as a count', () => {
    const { rerender } = render(
      <EntityMultiPicker
        options={PROJECTS_MULTI}
        value={['p1']}
        onToggle={vi.fn()}
        placeholder="Add projects"
        singularLabel="project"
        pluralLabel="projects"
        ariaLabel="Projects"
      />,
    );
    expect(screen.getByText('Migration')).toBeInTheDocument();
    rerender(
      <EntityMultiPicker
        options={PROJECTS_MULTI}
        value={['p1', 'p2']}
        onToggle={vi.fn()}
        placeholder="Add projects"
        singularLabel="project"
        pluralLabel="projects"
        ariaLabel="Projects"
      />,
    );
    expect(screen.getByText('2 projects')).toBeInTheDocument();
  });

  it('renders read-only with no opener', () => {
    render(
      <EntityMultiPicker
        options={PROJECTS_MULTI}
        value={['p1']}
        onToggle={vi.fn()}
        placeholder="Add projects"
        singularLabel="project"
        pluralLabel="projects"
        ariaLabel="Projects"
        readOnly
      />,
    );
    expect(screen.getByText('Migration')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('CalendarGrid month navigation', () => {
  it('moves to the next and previous month via the header buttons', () => {
    render(
      <CalendarGrid
        value="2026-08-15"
        onSelect={vi.fn()}
        ariaLabel="Due date"
        min="2020-01-01"
        max="2030-12-31"
      />,
    );
    expect(screen.getByRole('heading', { name: 'August 2026' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByRole('heading', { name: 'September 2026' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(screen.getByRole('heading', { name: 'July 2026' })).toBeInTheDocument();
  });

  it('moves a year at a time with Shift+PageUp/PageDown', () => {
    render(
      <CalendarGrid
        value="2026-08-15"
        onSelect={vi.fn()}
        ariaLabel="Due date"
        min="2020-01-01"
        max="2030-12-31"
      />,
    );
    const grid = screen.getByRole('grid', { name: 'Due date' });
    fireEvent.keyDown(grid, { key: 'PageDown', shiftKey: true });
    expect(screen.getByRole('heading', { name: 'August 2027' })).toBeInTheDocument();
    fireEvent.keyDown(grid, { key: 'PageUp', shiftKey: true });
    expect(screen.getByRole('heading', { name: 'August 2026' })).toBeInTheDocument();
  });

  it('moves a month at a time with PageUp/PageDown (no shift)', () => {
    render(
      <CalendarGrid
        value="2026-08-15"
        onSelect={vi.fn()}
        ariaLabel="Due date"
        min="2020-01-01"
        max="2030-12-31"
      />,
    );
    const grid = screen.getByRole('grid', { name: 'Due date' });
    fireEvent.keyDown(grid, { key: 'PageDown' });
    expect(screen.getByRole('heading', { name: 'September 2026' })).toBeInTheDocument();
  });

  it('moves within the week with Home/End and up/down a week with ArrowUp/ArrowDown', () => {
    render(
      <CalendarGrid
        value="2026-08-15"
        onSelect={vi.fn()}
        ariaLabel="Due date"
        min="2020-01-01"
        max="2030-12-31"
      />,
    );
    const grid = screen.getByRole('grid', { name: 'Due date' });
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    fireEvent.keyDown(grid, { key: 'Home' });
    fireEvent.keyDown(grid, { key: 'End' });
    fireEvent.keyDown(grid, { key: 'ArrowUp' });
    // No day is out of range for this window, so nothing throws and the header stays in August.
    expect(screen.getByRole('heading', { name: 'August 2026' })).toBeInTheDocument();
  });

  it('commits the focused day with Space and disables navigation past the min/max bounds', () => {
    const onSelect = vi.fn();
    render(
      <CalendarGrid
        value="2026-01-15"
        onSelect={onSelect}
        ariaLabel="Due date"
        min="2026-01-01"
        max="2026-01-31"
      />,
    );
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled();
    const grid = screen.getByRole('grid', { name: 'Due date' });
    fireEvent.keyDown(grid, { key: ' ' });
    expect(onSelect).toHaveBeenCalledWith('2026-01-15');
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
    // The trigger renders a short locale day, not the raw ISO string.
    expect(screen.queryByText('2026-03-15')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Due date —/ }));
    // The popover hosts a real month grid whose cells are named by their ISO day, so a day is
    // chosen by clicking it — there is no free-text field to type an arbitrary value into.
    const grid = await screen.findByRole('grid', { name: 'Due date' });
    fireEvent.click(within(grid).getByRole('button', { name: '2026-04-01' }));
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

  it('jumps to today and closes via the Today shortcut', async () => {
    const onChange = vi.fn();
    render(
      <DatePicker
        value={null}
        onChange={onChange}
        placeholder="Set due date"
        ariaLabel="Due date"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Due date —/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Today' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    });
  });

  it('hides the Clear affordance and disables Today when nothing is set / today is out of range', async () => {
    render(
      <DatePicker
        value={null}
        onChange={vi.fn()}
        placeholder="Set due date"
        ariaLabel="Due date"
        min="1970-01-01"
        max="1970-01-02"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Due date —/ }));
    await screen.findByRole('grid');
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Today' })).toBeDisabled();
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
    // The range picker opens on its Start bound; the grid is bounded above by the current end,
    // so an inverted window cannot be produced by any sequence of clicks.
    const grid = await screen.findByRole('grid', { name: 'Timeline Start' });
    fireEvent.click(within(grid).getByRole('button', { name: '2026-01-15' }));
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

  it('renders read-only with no opener', () => {
    render(
      <DateRangePicker
        value={{ start: '2026-01-01', end: '2026-02-01' }}
        onChange={vi.fn()}
        placeholder="Set timeline"
        ariaLabel="Timeline"
        readOnly
      />,
    );
    expect(screen.getByText(/2026/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('advances to the End tab when an in-range start is chosen, keeping the existing end', async () => {
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
    const startGrid = await screen.findByRole('grid', { name: 'Timeline Start' });
    fireEvent.click(within(startGrid).getByRole('button', { name: '2026-01-15' }));
    expect(onChange).toHaveBeenCalledWith({ start: '2026-01-15', end: '2026-02-01' });
    // Selecting a start advances the segmented control to End.
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /^End/ })).toHaveAttribute('aria-selected', 'true');
    });
  });

  it('sets the end bound and closes when the End tab is active', async () => {
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
    fireEvent.click(await screen.findByRole('tab', { name: /^End/ }));
    const endGrid = await screen.findByRole('grid', { name: 'Timeline End' });
    fireEvent.click(within(endGrid).getByRole('button', { name: '2026-02-15' }));
    expect(onChange).toHaveBeenCalledWith({ start: '2026-01-01', end: '2026-02-15' });
    await waitFor(() => {
      expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    });
  });

  it('jumps the start bound to today and advances to the End tab', async () => {
    const onChange = vi.fn();
    render(
      <DateRangePicker
        value={{ start: '1970-01-01', end: null }}
        onChange={onChange}
        placeholder="Set timeline"
        ariaLabel="Timeline"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Timeline —/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Today' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ end: null }));
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /^End/ })).toHaveAttribute('aria-selected', 'true');
    });
  });

  it('jumps the end bound to today and closes when the End tab is active', async () => {
    const onChange = vi.fn();
    render(
      <DateRangePicker
        value={{ start: '1970-01-01', end: '1970-01-02' }}
        onChange={onChange}
        placeholder="Set timeline"
        ariaLabel="Timeline"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Timeline —/ }));
    fireEvent.click(await screen.findByRole('tab', { name: /^End/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Today' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ start: '1970-01-01' }));
    await waitFor(() => {
      expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    });
  });

  it('clears both bounds and resets to the Start tab', async () => {
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
    fireEvent.click(await screen.findByRole('button', { name: 'Clear' }));
    expect(onChange).toHaveBeenCalledWith({ start: null, end: null });
    await waitFor(() => {
      expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    });
  });
});

describe('LabelsPicker inline creation', () => {
  const LABELS: PickerOption[] = [
    { value: 'l1', label: 'bug' },
    { value: 'l2', label: 'design' },
  ];

  /** Open the picker's popover and return its search input. */
  async function openPicker(ui: React.ReactElement): Promise<HTMLElement> {
    render(ui);
    fireEvent.click(screen.getByRole('button'));
    return await screen.findByRole('textbox');
  }

  it('offers a create row for a name the org does not have', async () => {
    const onCreate = vi.fn();
    const input = await openPicker(
      <LabelsPicker options={LABELS} value={[]} onToggle={vi.fn()} onCreate={onCreate} />,
    );
    fireEvent.change(input, { target: { value: 'onboarding' } });

    const create = await screen.findByText('Create “onboarding”');
    fireEvent.click(create);
    expect(onCreate).toHaveBeenCalledWith('onboarding');
  });

  it('offers the existing label instead of a near-duplicate when case differs', async () => {
    // The DB unique is case-sensitive by decision, so this is where `Bug` beside `bug` has to
    // be prevented — otherwise every picker slowly fills with the same label twice.
    const onCreate = vi.fn();
    const input = await openPicker(
      <LabelsPicker options={LABELS} value={[]} onToggle={vi.fn()} onCreate={onCreate} />,
    );
    fireEvent.change(input, { target: { value: 'BUG' } });

    expect(screen.queryByText(/^Create/)).toBeNull();
  });

  it('never offers creation for a blank query', async () => {
    const input = await openPicker(
      <LabelsPicker options={LABELS} value={[]} onToggle={vi.fn()} onCreate={vi.fn()} />,
    );
    fireEvent.change(input, { target: { value: '   ' } });
    expect(screen.queryByText(/^Create/)).toBeNull();
  });

  it('omits the create row entirely when the caller supplies no handler', async () => {
    // The initiatives reuse of this picker passes no `onCreate`; it must not offer to
    // create an initiative from a label picker.
    const input = await openPicker(<LabelsPicker options={LABELS} value={[]} onToggle={vi.fn()} />);
    fireEvent.change(input, { target: { value: 'brand new' } });
    expect(screen.queryByText(/^Create/)).toBeNull();
  });

  it('reaches the create row by keyboard like any other row', async () => {
    // The create row joins the same flat row model, so Down-arrow walks onto it and Enter
    // activates it — it is not a mouse-only affordance.
    const onCreate = vi.fn();
    const input = await openPicker(
      <LabelsPicker options={LABELS} value={[]} onToggle={vi.fn()} onCreate={onCreate} />,
    );
    fireEvent.change(input, { target: { value: 'onboarding' } });
    // Query matches nothing, so the create row is the only row and is already active.
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCreate).toHaveBeenCalledWith('onboarding');
  });
});
