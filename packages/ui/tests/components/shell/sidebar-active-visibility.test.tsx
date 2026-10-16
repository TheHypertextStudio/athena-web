import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ContextProvider } from '../../../src/components/shell/ContextProvider';
import { Sidebar } from '../../../src/components/shell/Sidebar';
import type { WorkspaceNavKey } from '../../../src/components/shell/workspaces';
const geometry = { height: 300, width: 240 };
const observers: TestResizeObserver[] = [];
let pageScroll: ReturnType<typeof vi.spyOn>;
class TestResizeObserver implements ResizeObserver {
  readonly disconnect = vi.fn();
  constructor(readonly callback: ResizeObserverCallback) {
    observers.push(this);
  }
  observe(): void {
    return;
  }
  unobserve(): void {
    return;
  }
}
function bounds(this: HTMLElement): DOMRect {
  if (this.dataset['testid'] === 'sidebar-scroll-region')
    return new DOMRect(0, 40, geometry.width, geometry.height);
  if (this.getAttribute('aria-current') === 'page') {
    const top = this.textContent.includes('Projects') ? 420 : 330;
    const region = this.closest<HTMLElement>('[data-testid="sidebar-scroll-region"]');
    return new DOMRect(0, top - (region?.scrollTop ?? 0), geometry.width, 40);
  }
  return new DOMRect();
}
function Fixture({
  active = 'work-templates',
  unreadCount = 0,
}: {
  readonly active?: WorkspaceNavKey;
  readonly unreadCount?: number;
}) {
  return (
    <ContextProvider initialContext="01ARZ3NDEKTSV4RRFFQ69G5FAX">
      <Sidebar
        workspaces={[{ id: '01ARZ3NDEKTSV4RRFFQ69G5FAX', name: 'Studio' }]}
        activeWorkspaceKey={active}
        unreadCount={unreadCount}
        hrefForHome={(key) => `/${key}`}
        hrefForWorkspace={(org, key) => `/orgs/${org}/${key}`}
        renderLink={(href: string, children: ReactNode) => <a href={href}>{children}</a>}
        onSelectWorkspace={vi.fn()}
        onCreateWorkspace={vi.fn()}
        onOpenSearch={vi.fn()}
      />
    </ContextProvider>
  );
}
beforeEach(() => {
  geometry.height = 300;
  geometry.width = 240;
  observers.length = 0;
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(bounds);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.dataset['testid'] === 'sidebar-scroll-region' ? geometry.height : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.dataset['testid'] === 'sidebar-scroll-region' ? geometry.width : 0;
  });
  pageScroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('reveals a clipped active destination on expanded mount by moving only its own scroll region', () => {
  render(<Fixture />);
  expect(screen.getByTestId('sidebar-scroll-region').scrollTop).toBe(30);
  expect(pageScroll).not.toHaveBeenCalled();
});
it('reveals a newly active destination below or above the current sidebar viewport', () => {
  const view = render(<Fixture />),
    region = screen.getByTestId('sidebar-scroll-region');
  view.rerender(<Fixture active="projects" />);
  expect(region.scrollTop).toBe(120);
  region.scrollTop = 450;
  view.rerender(<Fixture active="work-templates" />);
  expect(region.scrollTop).toBe(290);
  expect(pageScroll).not.toHaveBeenCalled();
});
it('responds to actual available-region resize but does not undo deliberate user scrolling at the same size', () => {
  render(<Fixture />);
  const region = screen.getByTestId('sidebar-scroll-region');
  geometry.height = 200;
  act(() => {
    for (const observer of observers) observer.callback([], observer);
  });
  expect(region.scrollTop).toBe(130);
  region.scrollTop = 200;
  fireEvent.scroll(region);
  act(() => {
    for (const observer of observers) observer.callback([], observer);
  });
  expect(region.scrollTop).toBe(200);
});
it('does not fight manual sidebar scrolling on unrelated updates or move the page', () => {
  const view = render(<Fixture />),
    region = screen.getByTestId('sidebar-scroll-region');
  region.scrollTop = 200;
  fireEvent.scroll(region);
  view.rerender(<Fixture unreadCount={5} />);
  expect(region.scrollTop).toBe(200);
  expect(pageScroll).not.toHaveBeenCalled();
});
it('disconnects region observation when expanded navigation unmounts', () => {
  const view = render(<Fixture />);
  expect(observers.length).toBeGreaterThan(0);
  view.unmount();
  expect(observers.every((observer) => observer.disconnect.mock.calls.length > 0)).toBe(true);
});
