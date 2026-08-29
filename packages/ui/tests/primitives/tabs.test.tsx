import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Tab, TabList, Tabs, type TabsItem } from '../../src/primitives/tabs';

/** A controlled data-driven host mirroring the documented drop-in usage. */
function DataDrivenTabs({
  items,
  initial,
}: {
  readonly items: readonly TabsItem[];
  readonly initial: string;
}): React.JSX.Element {
  const [value, setValue] = useState(initial);
  return <Tabs value={value} onValueChange={setValue} label="Project sections" items={items} />;
}

const ITEMS: TabsItem[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'tasks', label: 'Tasks', count: 4 },
  { value: 'settings', label: 'Settings', disabled: true },
];

describe('Tabs (data-driven)', () => {
  it('renders a tablist with the accessible label and one tab per item', () => {
    render(<DataDrivenTabs items={ITEMS} initial="overview" />);
    const tablist = screen.getByRole('tablist', { name: 'Project sections' });
    expect(within(tablist).getAllByRole('tab')).toHaveLength(3);
  });

  it('marks the selected tab with aria-selected and a roving tabIndex', () => {
    render(<DataDrivenTabs items={ITEMS} initial="tasks" />);
    const selected = screen.getByRole('tab', { name: /Tasks/ });
    const other = screen.getByRole('tab', { name: 'Overview' });
    expect(selected).toHaveAttribute('aria-selected', 'true');
    expect(selected).toHaveAttribute('tabindex', '0');
    expect(other).toHaveAttribute('aria-selected', 'false');
    expect(other).toHaveAttribute('tabindex', '-1');
  });

  it('renders a trailing count pill when count is supplied', () => {
    render(<DataDrivenTabs items={ITEMS} initial="overview" />);
    const tasksTab = screen.getByRole('tab', { name: /Tasks/ });
    expect(tasksTab).toHaveTextContent('4');
  });

  it('renders a disabled tab that cannot be selected', () => {
    render(<DataDrivenTabs items={ITEMS} initial="overview" />);
    expect(screen.getByRole('tab', { name: 'Settings' })).toBeDisabled();
  });

  it('selects a tab on click', () => {
    render(<DataDrivenTabs items={ITEMS} initial="overview" />);
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    fireEvent.click(screen.getByRole('tab', { name: /Tasks/ }));
    expect(screen.getByRole('tab', { name: /Tasks/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('wires aria-controls/id from the tab value, matching a caller-rendered tabpanel', () => {
    render(<DataDrivenTabs items={ITEMS} initial="overview" />);
    const tab = screen.getByRole('tab', { name: 'Overview' });
    expect(tab).toHaveAttribute('id', 'tab-overview');
    expect(tab).toHaveAttribute('aria-controls', 'tabpanel-overview');
  });
});

describe('Tabs (adaptive overflow)', () => {
  it('keeps each visible section label on one line and truncates it before the lane can wrap', () => {
    render(
      <Tabs
        value="overview"
        onValueChange={() => undefined}
        label="Initiative sections"
        overflow={{ menuLabel: 'More Initiative sections' }}
        items={[{ value: 'overview', label: 'A deliberately long section label', priority: 0 }]}
      />,
    );

    const tab = screen.getByRole('tab', { name: 'A deliberately long section label' });
    expect(tab).toHaveClass('whitespace-nowrap');
    expect(tab.querySelector('span')).toHaveClass('truncate');
  });

  it('keeps the selected section inline and exposes remaining sections in a named menu', () => {
    render(
      <Tabs
        value="resources"
        onValueChange={() => undefined}
        label="Initiative sections"
        overflow={{ menuLabel: 'More Initiative sections' }}
        items={[
          { value: 'overview', label: 'Overview', priority: 0 },
          { value: 'subinitiatives', label: 'Sub-initiatives', priority: 1 },
          { value: 'work', label: 'Connected work', priority: 2 },
          { value: 'updates', label: 'Updates', priority: 3 },
          { value: 'resources', label: 'Resources', priority: 4 },
        ]}
      />,
    );

    expect(screen.getByRole('tab', { name: 'Resources' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More Initiative sections' })).toBeInTheDocument();
  });

  it('promotes a section selected from the menu into the tablist', () => {
    function OverflowHost(): React.JSX.Element {
      const [value, setValue] = useState('overview');
      return (
        <Tabs
          value={value}
          onValueChange={setValue}
          label="Initiative sections"
          overflow={{ menuLabel: 'More Initiative sections' }}
          items={[
            { value: 'overview', label: 'Overview', priority: 0 },
            { value: 'subinitiatives', label: 'Sub-initiatives', priority: 1 },
            { value: 'work', label: 'Connected work', priority: 2 },
            { value: 'updates', label: 'Updates', priority: 3 },
            { value: 'resources', label: 'Resources', priority: 4 },
          ]}
        />
      );
    }

    render(<OverflowHost />);
    expect(screen.queryByRole('tab', { name: 'Resources' })).toBeNull();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'More Initiative sections' }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Resources' }));
    expect(screen.getByRole('tab', { name: 'Resources' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('Tabs (composable)', () => {
  function ComposableHost(): React.JSX.Element {
    const [value, setValue] = useState('a');
    return (
      <Tabs value={value} onValueChange={setValue}>
        <TabList label="Custom tabs">
          <Tab value="a">First</Tab>
          <Tab value="b" count={2}>
            Second
          </Tab>
        </TabList>
      </Tabs>
    );
  }

  it('renders caller-composed TabList/Tab children instead of the data-driven list', () => {
    render(<ComposableHost />);
    expect(screen.getByRole('tablist', { name: 'Custom tabs' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'First' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Second/ })).toHaveTextContent('2');
  });

  it('throws when Tab is rendered outside a Tabs root', () => {
    // Swallow the expected React error-boundary console noise this deliberately triggers.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => {
      render(<Tab value="orphan">Orphan</Tab>);
    }).toThrow('Tabs.* subcomponents must be rendered within a <Tabs> root.');
    spy.mockRestore();
  });
});

describe('TabList keyboard navigation', () => {
  function KeyboardHost(): React.JSX.Element {
    const [value, setValue] = useState('overview');
    return <Tabs value={value} onValueChange={setValue} label="Sections" items={ITEMS} />;
  }

  it('ArrowRight moves focus and selection to the next tab, wrapping past the end', () => {
    render(<KeyboardHost />);
    const tablist = screen.getByRole('tablist');
    const overview = screen.getByRole('tab', { name: 'Overview' });
    overview.focus();

    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    // The disabled Settings tab is excluded from the roving order, so ArrowRight from Tasks wraps
    // back to Overview rather than landing on a tab that cannot be activated.
    expect(screen.getByRole('tab', { name: /Tasks/ })).toHaveFocus();
    expect(screen.getByRole('tab', { name: /Tasks/ })).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveFocus();
  });

  it('ArrowLeft moves focus and selection to the previous tab, wrapping before the start', () => {
    render(<KeyboardHost />);
    const tablist = screen.getByRole('tablist');
    screen.getByRole('tab', { name: 'Overview' }).focus();

    fireEvent.keyDown(tablist, { key: 'ArrowLeft' });
    // Wraps to the last enabled tab (Tasks — Settings is disabled and excluded).
    expect(screen.getByRole('tab', { name: /Tasks/ })).toHaveFocus();
    expect(screen.getByRole('tab', { name: /Tasks/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('Home moves to the first tab and End to the last enabled tab', () => {
    render(<KeyboardHost />);
    const tablist = screen.getByRole('tablist');
    screen.getByRole('tab', { name: 'Overview' }).focus();

    fireEvent.keyDown(tablist, { key: 'End' });
    expect(screen.getByRole('tab', { name: /Tasks/ })).toHaveFocus();

    fireEvent.keyDown(tablist, { key: 'Home' });
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveFocus();
  });

  it('ignores keys outside the nav set', () => {
    render(<KeyboardHost />);
    const tablist = screen.getByRole('tablist');
    screen.getByRole('tab', { name: 'Overview' }).focus();
    fireEvent.keyDown(tablist, { key: 'Tab' });
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  });

  it('is a no-op when the currently-focused element is not one of the tabs', () => {
    render(<KeyboardHost />);
    const tablist = screen.getByRole('tablist');
    // Nothing inside the tablist is focused (default document focus), so `currentIndex` resolves
    // to -1 and ArrowRight must fall back to selecting the first enabled tab rather than throwing.
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  });
});
