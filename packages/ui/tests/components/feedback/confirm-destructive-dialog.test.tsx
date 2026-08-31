import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmDestructiveDialog } from '../../../src/components/feedback/ConfirmDestructiveDialog';

/** The props every case shares, so each test states only what it is about. */
function baseProps() {
  return {
    open: true,
    onOpenChange: vi.fn(),
    title: 'Delete project?',
    description: 'This permanently removes the project and its tasks.',
    confirmLabel: 'Delete project',
    onConfirm: vi.fn(),
  };
}

describe('ConfirmDestructiveDialog', () => {
  it('renders nothing while closed', () => {
    render(<ConfirmDestructiveDialog {...baseProps()} open={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('names what will happen and what confirming does', () => {
    render(<ConfirmDestructiveDialog {...baseProps()} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Delete project?');
    expect(dialog).toHaveTextContent('This permanently removes the project and its tasks.');
    // The confirming control is labelled with the action, never a bare "OK".
    expect(screen.getByRole('button', { name: 'Delete project' })).toBeInTheDocument();
  });

  it('confirms only when the destructive control is chosen', () => {
    const props = baseProps();
    render(<ConfirmDestructiveDialog {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete project' }));
    expect(props.onConfirm).toHaveBeenCalledTimes(1);
    expect(props.onOpenChange).not.toHaveBeenCalled();
  });

  it('closes without acting when the operator backs out', () => {
    const props = baseProps();
    render(<ConfirmDestructiveDialog {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onConfirm).not.toHaveBeenCalled();
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it('resists dismissal and disables both controls while the action is in flight', () => {
    const props = baseProps();
    render(<ConfirmDestructiveDialog {...props} pending />);

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    // An in-flight delete must not be interruptible: Escape is inert too, so a half-finished
    // request cannot be abandoned with the dialog closed over it.
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(props.onOpenChange).not.toHaveBeenCalled();
  });

  it('surfaces a failure inside the dialog so it is not hidden behind the modal', () => {
    render(
      <ConfirmDestructiveDialog
        {...baseProps()}
        error="Could not delete the project. Try again."
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Could not delete the project. Try again.');
  });

  it('renders no alert when there is no failure', () => {
    render(<ConfirmDestructiveDialog {...baseProps()} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('treats a cleared failure the same as none', () => {
    render(<ConfirmDestructiveDialog {...baseProps()} error={null} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('disables the destructive control while the action is in flight', () => {
    const props = baseProps();
    render(<ConfirmDestructiveDialog {...props} pending />);

    const confirm = screen.getByRole('button', { name: 'Delete project' });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  it('accepts rich nodes for its title and description', () => {
    render(
      <ConfirmDestructiveDialog
        {...baseProps()}
        title={<span data-testid="rich-title">Delete Acme?</span>}
        description={<span data-testid="rich-description">Every task goes with it.</span>}
      />,
    );

    expect(screen.getByTestId('rich-title')).toBeInTheDocument();
    expect(screen.getByTestId('rich-description')).toBeInTheDocument();
  });

  it('dismisses on Escape when nothing is in flight', () => {
    const props = baseProps();
    render(<ConfirmDestructiveDialog {...props} />);

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(props.onConfirm).not.toHaveBeenCalled();
  });
});
