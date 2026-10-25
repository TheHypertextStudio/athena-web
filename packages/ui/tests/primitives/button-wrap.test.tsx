import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Button, buttonVariants } from '../../src/primitives/button';
import { ControlGroup } from '../../src/primitives/control';
afterEach(cleanup);
it('wraps a full accessible action label within its surface while inheriting the shared minimum height', () => {
  const action = vi.fn();
  render(
    <ControlGroup controlSize="lg">
      <Button wrapLabel onClick={action}>
        Choose starting points
      </Button>
      <Button>Other action</Button>
    </ControlGroup>,
  );
  const wrapped = screen.getByRole('button', { name: 'Choose starting points' });
  expect(wrapped).toHaveClass('min-h-9', 'coarse:min-h-10', 'max-w-full', 'whitespace-normal');
  expect(wrapped).not.toHaveClass('h-9', 'coarse:h-10');
  expect(wrapped).not.toHaveAttribute('wrapLabel');
  fireEvent.click(wrapped);
  expect(action).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Other action' })).toHaveClass('h-9', 'coarse:h-10');
});
it('uses the same wrapping geometry for an asChild link and the static class builder', () => {
  render(
    <Button asChild wrapLabel controlSize="lg">
      <a href="/templates">Review a long template name</a>
    </Button>,
  );
  const link = screen.getByRole('link', { name: 'Review a long template name' });
  expect(link).toHaveAttribute('href', '/templates');
  expect(link.className).toBe(buttonVariants({ wrapLabel: true, controlSize: 'lg' }));
  expect(link).toHaveClass('min-h-9', 'whitespace-normal');
});
it('keeps icon-only controls square even when wrapping was requested', () => {
  render(<Button wrapLabel iconOnly aria-label="More actions" />);
  expect(screen.getByRole('button', { name: 'More actions' })).toHaveClass('h-8', 'w-8');
  expect(screen.getByRole('button', { name: 'More actions' })).not.toHaveClass('whitespace-normal');
});
