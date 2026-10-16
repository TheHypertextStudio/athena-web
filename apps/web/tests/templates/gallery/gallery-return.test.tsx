import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useGalleryBrowseReturn } from '@/components/templates/gallery/use-gallery-return';
const scroll = vi.hoisted(() => ({ read: vi.fn(() => ({ top: 642, left: 0 })), restore: vi.fn() }));
vi.mock('@/lib/app-location', () => ({
  shellScrollPosition: scroll.read,
  restoreShellScroll: scroll.restore,
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('returns keyboard focus to the actual catalog row without adding a second scroll owner', () => {
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callback(0);
    return 1;
  });
  render(
    <>
      <a href="/gallery/event" data-gallery-slug="event">
        Event
      </a>
      <button>Another control</button>
    </>,
  );
  const hook = renderHook(() => useGalleryBrowseReturn({ userId: 'viewer', orgId: 'workspace' }));
  act(() => {
    hook.result.current.remember('event');
  });
  screen.getByRole('button', { name: 'Another control' }).focus();
  act(() => {
    hook.result.current.restore();
  });
  expect(scroll.restore).toHaveBeenCalledWith({ top: 642, left: 0 });
  expect(screen.getByRole('link', { name: 'Event' })).toHaveFocus();
});
