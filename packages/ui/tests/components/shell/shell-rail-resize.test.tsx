import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Home } from '../../../src/icons';
import { AppShell } from '../../../src/components/shell/AppShell';
import { ContextProvider } from '../../../src/components/shell/ContextProvider';
import {
  RAIL_MAX_INLINE_SIZE_PX,
  RAIL_MIN_INLINE_SIZE_PX,
  railClampWidthPx,
  railResizeMaxPx,
  ShellAside,
} from '../../../src/components/shell/ShellAside';
import { Sidebar } from '../../../src/components/shell/Sidebar';
import type { Workspace } from '../../../src/components/shell/workspaces';

const ACME: Workspace = { id: 'ORG00000000000000000000001', name: 'Acme Co' };
const WORKSPACES: readonly Workspace[] = [ACME];

const PANEL = { id: 'athena', label: 'Athena', icon: <Home />, node: <div>Athena body</div> };

function renderLink(href: string, content: React.ReactNode, className?: string): React.ReactNode {
  return (
    <a
      href={href}
      className={className}
      onClick={(event) => {
        event.preventDefault();
      }}
    >
      {content}
    </a>
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
});

describe('ShellAside resize handle', () => {
  it('reports the resolved clamp width as aria-valuenow, bounded by half the viewport', () => {
    render(<ShellAside panel={PANEL} collapsed={false} onWidthChange={vi.fn()} />);

    const handle = screen.getByRole('separator', { name: 'Resize Athena' });
    expect(handle).toHaveAttribute('aria-orientation', 'vertical');
    expect(handle).toHaveAttribute('aria-valuemin', String(RAIL_MIN_INLINE_SIZE_PX));
    expect(handle).toHaveAttribute('aria-valuemax', String(railResizeMaxPx(window.innerWidth)));
    expect(handle).toHaveAttribute(
      'aria-valuenow',
      String(Math.round(railClampWidthPx(window.innerWidth))),
    );
  });

  it('does not render a handle when the host offers no onWidthChange', () => {
    render(<ShellAside panel={PANEL} collapsed={false} />);

    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
  });

  it('does not render a handle while the rail is collapsed', () => {
    render(<ShellAside panel={PANEL} collapsed onWidthChange={vi.fn()} />);

    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
  });

  it('widens with ArrowLeft and narrows with ArrowRight, in 16px steps', () => {
    const onWidthChange = vi.fn();
    render(
      <ShellAside panel={PANEL} collapsed={false} width={400} onWidthChange={onWidthChange} />,
    );
    const handle = screen.getByRole('separator', { name: 'Resize Athena' });

    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(onWidthChange).toHaveBeenLastCalledWith(416);

    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(onWidthChange).toHaveBeenLastCalledWith(384);
  });

  it('clamps ArrowRight at the floor and ArrowLeft at half the viewport', () => {
    const onWidthChangeAtFloor = vi.fn();
    render(
      <ShellAside
        panel={PANEL}
        collapsed={false}
        width={RAIL_MIN_INLINE_SIZE_PX}
        onWidthChange={onWidthChangeAtFloor}
      />,
    );
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize Athena' }), {
      key: 'ArrowRight',
    });
    expect(onWidthChangeAtFloor).toHaveBeenLastCalledWith(RAIL_MIN_INLINE_SIZE_PX);
    cleanup();

    const max = railResizeMaxPx(window.innerWidth);
    const onWidthChangeAtCap = vi.fn();
    render(
      <ShellAside panel={PANEL} collapsed={false} width={max} onWidthChange={onWidthChangeAtCap} />,
    );
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize Athena' }), {
      key: 'ArrowLeft',
    });
    expect(onWidthChangeAtCap).toHaveBeenLastCalledWith(max);
  });

  it('jumps to the floor on Home and to half the viewport on End', () => {
    const onWidthChange = vi.fn();
    render(
      <ShellAside panel={PANEL} collapsed={false} width={320} onWidthChange={onWidthChange} />,
    );
    const handle = screen.getByRole('separator', { name: 'Resize Athena' });

    fireEvent.keyDown(handle, { key: 'Home' });
    expect(onWidthChange).toHaveBeenLastCalledWith(RAIL_MIN_INLINE_SIZE_PX);

    fireEvent.keyDown(handle, { key: 'End' });
    expect(onWidthChange).toHaveBeenLastCalledWith(railResizeMaxPx(window.innerWidth));
  });

  it('updates the width as the pointer drags, moving left to widen the rail', () => {
    const onWidthChange = vi.fn();
    render(
      <ShellAside panel={PANEL} collapsed={false} width={400} onWidthChange={onWidthChange} />,
    );
    const handle = screen.getByRole('separator', { name: 'Resize Athena' });

    fireEvent.pointerDown(handle, { clientX: 500 });
    fireEvent.pointerMove(window, { clientX: 450 });
    // The edge faces `<main>`; dragging it further left (toward `<main>`) grows the rail.
    expect(onWidthChange).toHaveBeenLastCalledWith(450);

    fireEvent.pointerMove(window, { clientX: 470 });
    expect(onWidthChange).toHaveBeenLastCalledWith(430);

    fireEvent.pointerUp(window);
    fireEvent.pointerMove(window, { clientX: 300 });
    // No further calls after pointerup released the drag listeners.
    expect(onWidthChange).toHaveBeenCalledTimes(2);
  });

  it('shows the tonal fill while dragging, without adding a border', () => {
    render(<ShellAside panel={PANEL} collapsed={false} width={400} onWidthChange={vi.fn()} />);
    const handle = screen.getByRole('separator', { name: 'Resize Athena' });
    const fill = handle.firstElementChild as HTMLElement;

    expect(fill).not.toHaveClass('border');
    expect(fill.className).not.toMatch(/(?:^| )border(?:-|$)/);
    expect(fill).not.toHaveClass('bg-outline-variant');

    fireEvent.pointerDown(handle, { clientX: 500 });
    expect(fill).toHaveClass('bg-outline-variant');

    fireEvent.pointerUp(window);
    expect(fill).not.toHaveClass('bg-outline-variant');
  });

  it('renders a fixed 6px hit area over a 2px tonal fill', () => {
    render(<ShellAside panel={PANEL} collapsed={false} width={320} onWidthChange={vi.fn()} />);
    const handle = screen.getByRole('separator', { name: 'Resize Athena' });

    expect(handle).toHaveClass('w-1.5');
    expect(handle.firstElementChild).toHaveClass('w-0.5');
  });

  it('applies the stored width as the rail and its inner pin, past the CSS clamp', () => {
    render(<ShellAside panel={PANEL} collapsed={false} width={400} onWidthChange={vi.fn()} />);

    const aside = screen.getByRole('complementary', { name: 'Athena' });
    expect(aside).not.toHaveClass('w-[clamp(17.5rem,17vw,22rem)]');
    expect(aside).toHaveStyle({ width: '400px' });
  });
});

describe('AppShell rail resize', () => {
  function renderShell(): void {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    }));
    render(
      <ContextProvider initialContext={ACME.id}>
        <AppShell
          sidebar={
            <Sidebar
              workspaces={WORKSPACES}
              hrefForHome={(key) => `/${key}`}
              hrefForWorkspace={(orgId, key) => `/orgs/${orgId}/${key}`}
              renderLink={renderLink}
              onCreateWorkspace={() => undefined}
              onSelectWorkspace={() => undefined}
              onOpenSearch={() => undefined}
            />
          }
          aside={{ panels: [PANEL], defaultPanelId: 'athena' }}
        >
          <div>Main</div>
        </AppShell>
      </ContextProvider>,
    );
  }

  it('reads a stored width on mount and renders it as the rail and its resize bounds', async () => {
    window.localStorage.setItem('docket.rail.width', '400');
    renderShell();

    const aside = await screen.findByRole('complementary', { name: 'Athena' });
    expect(aside).toHaveStyle({ width: '400px' });
    expect(screen.getByRole('separator', { name: 'Resize Athena' })).toHaveAttribute(
      'aria-valuenow',
      '400',
    );
  });

  it('persists a keyboard resize under docket.rail.width and updates the rendered width', async () => {
    renderShell();
    const handle = await screen.findByRole('separator', { name: 'Resize Athena' });
    const startWidth = Number(handle.getAttribute('aria-valuenow'));

    fireEvent.keyDown(handle, { key: 'ArrowLeft' });

    expect(window.localStorage.getItem('docket.rail.width')).toBe(String(startWidth + 16));
    expect(screen.getByRole('complementary', { name: 'Athena' })).toHaveStyle({
      width: `${String(startWidth + 16)}px`,
    });
    expect(screen.getByRole('separator', { name: 'Resize Athena' })).toHaveAttribute(
      'aria-valuenow',
      String(startWidth + 16),
    );
  });

  it('keeps the maximum resizable width at half the window even on a very wide display', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 2400, configurable: true });
    window.localStorage.setItem('docket.rail.width', String(RAIL_MAX_INLINE_SIZE_PX));
    renderShell();

    expect(await screen.findByRole('separator', { name: 'Resize Athena' })).toHaveAttribute(
      'aria-valuemax',
      '1200',
    );
  });
});
