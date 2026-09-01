/**
 * `@docket/admin` — Vitest setup.
 *
 * @remarks
 * jsdom implements no observer APIs, so any screen rendering the section outline throws on mount
 * with `IntersectionObserver is not defined` — a jsdom gap rather than anything about the component.
 * The stub observes nothing and reports nothing, which leaves the outline in its no-active-section
 * state; a test that wants scroll-spy behavior replaces this writable global with its own.
 */
class IntersectionObserverStub {
  readonly root: Element | null = null;
  readonly rootMargin: string = '';
  readonly thresholds: readonly number[] = [];

  observe(): void {
    // Nothing is ever reported, so no target is ever active.
  }

  unobserve(): void {
    // Nothing is observed, so there is nothing to stop observing.
  }

  disconnect(): void {
    // Nothing is observed, so there is nothing to disconnect.
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

Object.defineProperty(globalThis, 'IntersectionObserver', {
  configurable: true,
  writable: true,
  value: IntersectionObserverStub,
});
