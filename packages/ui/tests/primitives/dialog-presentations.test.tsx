import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../src/primitives/dialog';

describe('Dialog presentations', () => {
  it('keeps header and footer fixed while one named body owns overflow', () => {
    render(
      <Dialog defaultOpen>
        <DialogContent presentation={{ kind: 'centered', size: 'standard', height: 'tall' }}>
          <DialogHeader>
            <DialogTitle>Project settings</DialogTitle>
          </DialogHeader>
          <DialogBody data-testid="body">content</DialogBody>
          <DialogFooter>
            <button type="button">Save</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Project settings' });
    expect(dialog).toHaveAttribute('data-surface-tone', 'floating');
    expect(dialog).toHaveClass('overflow-hidden', 'gap-0', 'p-0');
    expect(screen.getByTestId('body')).toHaveAttribute('data-overlay-scroll-owner', '');
    expect(screen.getByTestId('body')).toHaveClass('overflow-y-auto');
  });

  it('returns focus to a controlled dialog opener after Escape closes it', async () => {
    render(
      <Dialog>
        <DialogTrigger asChild>
          <button type="button">Open settings</button>
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Change this workspace.</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    const opener = screen.getByRole('button', { name: 'Open settings' });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Settings' }), { key: 'Escape' });
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
