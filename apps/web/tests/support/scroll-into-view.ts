import { vi, type Mock } from 'vitest';

/** The native scroll request, observed in JSDOM; real viewport behavior belongs to browser tests. */
export interface ScrollIntoViewSpy {
  readonly scroll: Mock<(options?: boolean | ScrollIntoViewOptions) => void>;
  readonly restore: () => void;
}
/** Install a reversible native-scroll spy without extracting an unbound DOM method. */
export function scrollIntoViewSpy(): ScrollIntoViewSpy {
  const previous = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
  const scroll = vi.fn<(options?: boolean | ScrollIntoViewOptions) => void>();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: scroll,
  });
  return {
    scroll,
    restore: () => {
      if (previous) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', previous);
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    },
  };
}
