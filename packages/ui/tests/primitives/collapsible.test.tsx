import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../src/primitives/collapsible';

function PermissionRow(): React.JSX.Element {
  return (
    <Collapsible>
      <CollapsibleTrigger>Read your work</CollapsibleTrigger>
      <CollapsibleContent>
        View your tasks, projects, programs, initiatives, and cycles.
      </CollapsibleContent>
    </Collapsible>
  );
}

describe('Collapsible family', () => {
  it('is closed until the trigger is activated, then reveals its content', async () => {
    const user = userEvent.setup();
    render(<PermissionRow />);
    expect(screen.queryByText(/View your tasks/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Read your work' }));

    expect(await screen.findByText(/View your tasks/)).toBeInTheDocument();
  });

  it('is keyboard-operable: Enter toggles the trigger', async () => {
    const user = userEvent.setup();
    render(<PermissionRow />);
    const trigger = screen.getByRole('button', { name: 'Read your work' });

    await user.tab();
    expect(trigger).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(await screen.findByText(/View your tasks/)).toBeInTheDocument();

    await user.keyboard('{Enter}');
    expect(screen.queryByText(/View your tasks/)).not.toBeInTheDocument();
  });

  it('exposes its open state via data-state and aria-expanded on the trigger', async () => {
    const user = userEvent.setup();
    render(<PermissionRow />);
    const trigger = screen.getByRole('button', { name: 'Read your work' });

    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAttribute('data-state', 'closed');

    await user.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('data-state', 'open');
  });
});
