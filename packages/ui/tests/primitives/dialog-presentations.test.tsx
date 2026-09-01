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

  it('keeps a responsive-fullscreen panel at its requested height once it leaves the phone layout', () => {
    render(
      <Dialog defaultOpen>
        <DialogContent
          presentation={{ kind: 'responsive-fullscreen', size: 'workspace', height: 'tall' }}
        >
          <DialogTitle>Settings</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    // The phone layout still fills the screen, and the panel keeps its width cap.
    expect(dialog).toHaveClass('h-[100dvh]', 'max-w-6xl');
    // The requested height has to be media-qualified to outrank the phone layout's own
    // `h-[100dvh]`; an unprefixed one loses and the panel collapses to its content.
    expect(dialog).toHaveClass('sm:h-[min(80dvh,48rem)]');
    // A blanket reset would outrank the requested height at exactly the widths it applies to.
    expect(dialog).not.toHaveClass('sm:h-auto');
  });

  it('lets a responsive-fullscreen panel size to its content when that is what it asked for', () => {
    render(
      <Dialog defaultOpen>
        <DialogContent
          presentation={{ kind: 'responsive-fullscreen', size: 'detail', height: 'content' }}
        >
          <DialogTitle>Details</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Details' });
    // `content` caps a maximum rather than setting a height, so it is the one case that still
    // needs the phone layout's height released.
    expect(dialog).toHaveClass('sm:h-auto', 'sm:max-h-[min(85dvh,48rem)]');
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
