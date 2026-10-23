import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import {
  Tabs,
  TabsScope,
  LazyTabPanels,
  TabPanel,
  type TabsVariant,
} from '../../src/primitives/tabs';
import { ExclusiveChoice } from '../../src/primitives/exclusive-choice';

function Sections({ variant = 'primary' }: { readonly variant?: TabsVariant }) {
  const [value, setValue] = useState('overview');
  return (
    <TabsScope>
      <Tabs
        variant={variant}
        label="Sections"
        value={value}
        onValueChange={setValue}
        items={[
          { value: 'overview', label: 'Overview' },
          { value: 'work', label: 'Work', count: 12345 },
          { value: 'disabled', label: 'Unavailable', disabled: true },
        ]}
      />
      <LazyTabPanels value={value} values={['overview', 'work', 'disabled']}>
        {value} content
      </LazyTabPanels>
    </TabsScope>
  );
}

describe('content tab contract', () => {
  it('associates each repeated instance with its own panel', () => {
    render(
      <>
        <Sections />
        <Sections />
      </>,
    );
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0]?.id).not.toBe(tabs[3]?.id);
    for (const tab of tabs) {
      const panel = document.getElementById(tab.getAttribute('aria-controls') ?? '');
      expect(panel).toHaveAttribute('role', 'tabpanel');
      expect(panel).toHaveAttribute('aria-labelledby', tab.id);
    }
  });
  it.each(['primary', 'secondary', 'contained'] as const)(
    'moves %s selection and focus past disabled tabs and retains full accessible counts',
    async (variant) => {
      const user = userEvent.setup();
      render(<Sections variant={variant} />);
      const first = screen.getByRole('tab', { name: 'Overview' });
      first.focus();
      await user.keyboard('{ArrowRight}');
      const work = screen.getByRole('tab', { name: 'Work 12345' });
      expect(work).toHaveFocus();
      expect(work).toHaveAttribute('aria-selected', 'true');
      expect(within(work).getByText('999+')).toBeVisible();
      expect(screen.getByRole('tabpanel')).toHaveTextContent('work content');
      await user.keyboard('{ArrowRight}');
      expect(first).toHaveFocus();
    },
  );

  it('contains navigation without decorative lines or a reserved leading scroll inset', () => {
    const { container } = render(<Sections variant="contained" />);
    const list = screen.getByRole('tablist');
    expect(list).toHaveAttribute('data-layout', 'scrollable');
    expect(list).not.toHaveClass('ps-[52px]');
    expect(container.querySelector('[data-tab-indicator]')).toBeNull();
    expect(container.querySelector('[data-orientation="horizontal"]')).toBeNull();
    expect(screen.getByRole('tab', { selected: true })).toHaveClass(
      'rounded-full',
      'bg-secondary-container',
    );
  });
});

it('exposes exclusive choices as radios without claiming content panels', async () => {
  const user = userEvent.setup();
  function Choice() {
    const [value, setValue] = useState('task');
    return (
      <ExclusiveChoice
        label="Send this to"
        value={value}
        onValueChange={setValue}
        items={[
          { value: 'task', label: 'Task' },
          { value: 'athena', label: 'Athena' },
        ]}
      />
    );
  }
  render(<Choice />);
  const task = screen.getByRole('radio', { name: 'Task' });
  expect(task).toHaveAttribute('aria-checked', 'true');
  task.focus();
  await user.keyboard('{ArrowRight}');
  expect(screen.getByRole('radio', { name: 'Athena' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
});

it('retains a hidden panel shell without evaluating its lazy contents', () => {
  function UnavailableContent(): never {
    throw new Error('Hidden content must stay lazy');
  }
  render(
    <TabsScope>
      <Tabs
        label="Sections"
        value="a"
        onValueChange={() => undefined}
        items={[
          { value: 'a', label: 'First' },
          { value: 'b', label: 'Later' },
        ]}
      />
      <TabPanel value="a">Ready</TabPanel>
      <TabPanel value="b" hidden render={() => <UnavailableContent />} />
    </TabsScope>,
  );
  const later = screen.getByRole('tab', { name: 'Later' });
  const shell = document.getElementById(later.getAttribute('aria-controls') ?? '');
  expect(shell).toHaveAttribute('hidden');
  expect(shell).toHaveAttribute('aria-labelledby', later.id);
  expect(screen.getByRole('tabpanel')).toHaveTextContent('Ready');
});

it('keeps an enabled tab in the keyboard sequence when validation disables the selected section', () => {
  render(
    <Tabs
      label="Editor sections"
      value="work"
      onValueChange={() => undefined}
      items={[
        { value: 'basics', label: 'Basics' },
        { value: 'work', label: 'Work', disabled: true },
      ]}
    />,
  );
  expect(screen.getByRole('tab', { name: 'Basics' })).toHaveAttribute('tabindex', '0');
  expect(screen.getByRole('tab', { name: 'Work' })).toHaveAttribute('aria-selected', 'true');
});
