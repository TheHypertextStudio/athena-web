import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Tabs, TabsScope, LazyTabPanels, TabPanel } from '../../src/primitives/tabs';
import { ExclusiveChoice } from '../../src/primitives/exclusive-choice';

function Sections() {
  const [value, setValue] = useState('overview');
  return (
    <TabsScope>
      <Tabs
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
  it('moves selection and focus past disabled tabs and retains full accessible counts', async () => {
    const user = userEvent.setup();
    render(<Sections />);
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
