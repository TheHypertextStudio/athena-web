import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Button } from '../../src/primitives/button';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '../../src/primitives/sheet';

/** A controlled left-side sheet mirroring the shell's mobile navigation drawer usage. */
function NavSheet(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger>Open navigation</SheetTrigger>
      <SheetContent side="left">
        <SheetTitle>Navigation</SheetTitle>
        <SheetDescription>Jump to a destination.</SheetDescription>
        <a href="/today">Today</a>
        <SheetClose asChild>
          <Button variant="ghost">Done</Button>
        </SheetClose>
      </SheetContent>
    </Sheet>
  );
}

/**
 * A controlled sheet opened from a STANDALONE button (no `SheetTrigger`) — exactly how the app
 * shell opens the mobile navigation drawer. Radix's built-in focus-restore only covers a
 * `SheetTrigger`, so this exercises the primitive's own opener capture/restore.
 */
function ControlledNavSheet(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        Menu
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left">
          <SheetTitle>Navigation</SheetTitle>
          <SheetDescription>Jump to a destination.</SheetDescription>
          <a href="/today">Today</a>
        </SheetContent>
      </Sheet>
    </>
  );
}

describe('Sheet family', () => {
  it.each([
    ['navigation', 'sm:w-72'],
    ['standard', 'sm:w-96'],
    ['wide', 'sm:w-[28rem]'],
  ] as const)(
    'keeps responsive %s panels full-width on phones and sized on desktop',
    async (size, desktopWidth) => {
      render(
        <Sheet defaultOpen>
          <SheetContent presentation="responsive-fullscreen" size={size}>
            <SheetTitle>Activity help</SheetTitle>
            <SheetDescription>Continue the current activity.</SheetDescription>
          </SheetContent>
        </Sheet>,
      );
      const sheet = await screen.findByRole('dialog');
      expect(sheet).toHaveClass('w-[100vw]', desktopWidth);
      expect(sheet).not.toHaveClass('sm:w-auto');
    },
  );

  it('opens from its trigger as a labelled, described modal dialog', async () => {
    render(<NavSheet />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Open navigation'));

    const sheet = await screen.findByRole('dialog');
    expect(sheet).toBeInTheDocument();
    // Radix wires aria-labelledby/aria-describedby from the title + description.
    expect(sheet).toHaveAccessibleName('Navigation');
    expect(sheet).toHaveAccessibleDescription('Jump to a destination.');
  });

  it('anchors to the left edge with the panel surface tone', async () => {
    render(<NavSheet />);
    fireEvent.click(screen.getByText('Open navigation'));
    const sheet = await screen.findByRole('dialog');
    // Left-anchored geometry and the shared floating panel treatment make the drawer distinct
    // from the page that remains behind the scrim.
    expect(sheet).toHaveAttribute('data-surface-tone', 'floating');
    expect(sheet).toHaveClass('left-0', 'inset-y-0');
  });

  it('anchors to the right edge when side="right"', async () => {
    render(
      <Sheet defaultOpen>
        <SheetContent side="right">
          <SheetTitle>Right panel</SheetTitle>
          <SheetDescription>The right-side sheet slides in from the right edge.</SheetDescription>
        </SheetContent>
      </Sheet>,
    );
    const sheet = await screen.findByRole('dialog');
    expect(sheet).toHaveClass('right-0');
    expect(sheet).not.toHaveClass('left-0');
  });

  it('renders the modal scrim and panel above app-local sticky layers', async () => {
    const { baseElement } = render(
      <Sheet defaultOpen>
        <SheetContent>
          <SheetTitle>With scrim</SheetTitle>
          <SheetDescription>The sheet renders above a dimmed page scrim.</SheetDescription>
        </SheetContent>
      </Sheet>,
    );
    const sheet = await screen.findByRole('dialog');
    const overlay = baseElement.querySelector('[data-overlay-scrim]');
    expect(overlay).not.toBeNull();
    expect(overlay).toHaveClass('z-(--z-sheet)');
    expect(sheet).toHaveClass('z-(--z-sheet)');
  });

  it('closes on Escape and returns focus to the opener', async () => {
    render(<NavSheet />);
    const opener = screen.getByText('Open navigation');
    opener.focus();
    fireEvent.click(opener);
    const sheet = await screen.findByRole('dialog');

    fireEvent.keyDown(sheet, { key: 'Escape', code: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    // WAI-ARIA: focus returns to the element that opened the sheet.
    await waitFor(() => {
      expect(opener).toHaveFocus();
    });
  });

  it('returns focus to a standalone opener (no SheetTrigger) on close — the shell drawer pattern', async () => {
    render(<ControlledNavSheet />);
    const opener = screen.getByRole('button', { name: 'Menu' });
    opener.focus();
    fireEvent.click(opener);
    const sheet = await screen.findByRole('dialog');

    fireEvent.keyDown(sheet, { key: 'Escape', code: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    // The drawer is opened from a controlled button, not a SheetTrigger; focus must still return.
    await waitFor(() => {
      expect(opener).toHaveFocus();
    });
  });

  it('does not crash and skips focus restore when the pre-open active element is not an HTMLElement', async () => {
    function SvgOpenedSheet(): React.JSX.Element {
      const [open, setOpen] = useState(false);
      return (
        <>
          <svg
            tabIndex={0}
            role="button"
            aria-label="Open via icon"
            data-testid="svg-opener"
            onClick={() => {
              setOpen(true);
            }}
          />
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetContent>
              <SheetTitle>Panel</SheetTitle>
              <SheetDescription>Opened from a non-HTMLElement trigger.</SheetDescription>
            </SheetContent>
          </Sheet>
        </>
      );
    }
    render(<SvgOpenedSheet />);
    const svgOpener = screen.getByTestId('svg-opener');
    svgOpener.focus();
    fireEvent.click(svgOpener);
    const sheet = await screen.findByRole('dialog');

    fireEvent.keyDown(sheet, { key: 'Escape', code: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(document.body).toHaveFocus();
  });

  it('closes via a SheetClose action', async () => {
    render(<NavSheet />);
    fireEvent.click(screen.getByText('Open navigation'));
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('merges a custom class onto the panel', async () => {
    render(
      <Sheet defaultOpen>
        <SheetContent className="panel-x">
          <SheetTitle>Styled</SheetTitle>
          <SheetDescription>The sheet accepts caller-provided panel classes.</SheetDescription>
        </SheetContent>
      </Sheet>,
    );
    const sheet = await screen.findByRole('dialog');
    expect(sheet).toHaveClass('panel-x');
  });
});

function StatefulHelpSheet(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [clicked, setClicked] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        Open help
      </button>
      <button
        type="button"
        onClick={() => {
          setClicked(true);
        }}
      >
        Outside action
      </button>
      {clicked ? <p>Outside action worked</p> : null}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent keepMounted side="right">
          <SheetTitle>Retained help</SheetTitle>
          <SheetDescription>Keep the unfinished message when help closes.</SheetDescription>
          <UnsentMessage />
          <SheetClose asChild>
            <Button>Back to plan</Button>
          </SheetClose>
        </SheetContent>
      </Sheet>
    </>
  );
}
function UnsentMessage(): React.JSX.Element {
  const [value, setValue] = useState('');
  return (
    <textarea
      aria-label="Message"
      value={value}
      onChange={(event) => {
        setValue(event.target.value);
      }}
    />
  );
}
it('retains mounted message state while releasing modal effects, focus, and accessibility on close', async () => {
  render(<StatefulHelpSheet />);
  const opener = screen.getByRole('button', { name: 'Open help' });
  opener.focus();
  fireEvent.click(opener);
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
    target: { value: 'Keep this unsent plan question' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Back to plan' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() => expect(opener).toHaveFocus());
  expect(document.body.style.pointerEvents).not.toBe('none');
  expect(screen.getByRole('button', { name: 'Outside action' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Outside action' }));
  expect(screen.getByText('Outside action worked')).toBeVisible();
  opener.focus();
  fireEvent.click(opener);
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue(
    'Keep this unsent plan question',
  );
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() => expect(opener).toHaveFocus());
});

it('gives portal Presence a real element while retained content reconnects under StrictMode', async () => {
  const computedStyle = vi.spyOn(window, 'getComputedStyle');
  try {
    render(
      <StrictMode>
        <StatefulHelpSheet />
      </StrictMode>,
    );
    const anchor = document.querySelector('[data-sheet-presence-anchor]');
    expect(anchor).toBeInstanceOf(HTMLElement);
    await waitFor(() => {
      expect(computedStyle).toHaveBeenCalledWith(anchor);
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const opener = screen.getByRole('button', { name: 'Open help' });
    opener.focus();
    fireEvent.click(opener);
    expect(await screen.findByRole('dialog', { name: 'Retained help' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Back to plan' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(computedStyle.mock.calls.every(([element]) => element instanceof Element)).toBe(true);
    await waitFor(() => expect(opener).toHaveFocus());
  } finally {
    computedStyle.mockRestore();
  }
});
