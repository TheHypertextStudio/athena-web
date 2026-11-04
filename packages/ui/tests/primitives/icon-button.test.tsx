import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { IconButton } from '../../src/primitives/icon-button';
import { TooltipProvider } from '../../src/primitives/tooltip';
import { Plus } from '../../src/icons';

afterEach(cleanup);

it('names an icon action for assistive technology and reveals its label on hover', async () => {
  const activate = vi.fn();
  render(
    <TooltipProvider delayDuration={0}>
      <IconButton label="Add to plan" onClick={activate}>
        <Plus />
      </IconButton>
    </TooltipProvider>,
  );
  const button = screen.getByRole('button', { name: 'Add to plan' });
  expect(button).not.toHaveTextContent('Add to plan');
  await userEvent.hover(button);
  expect(await screen.findByRole('tooltip')).toHaveTextContent('Add to plan');
  await userEvent.click(button);
  expect(activate).toHaveBeenCalledOnce();
});

it('does not submit a surrounding form when an icon action is activated', async () => {
  const submit = vi.fn((event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
  });
  render(
    <TooltipProvider>
      <form onSubmit={submit}>
        <IconButton label="Add to plan">
          <Plus />
        </IconButton>
      </form>
    </TooltipProvider>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Add to plan' }));
  expect(submit).not.toHaveBeenCalled();
});
