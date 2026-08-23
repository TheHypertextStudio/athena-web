'use client';

import {
  createContext,
  type JSX,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { flushSync } from 'react-dom';

/** A virtualized surface that can claim the browser find command. */
export interface InPageSearchTargetOptions {
  /** A stable diagnostic name for the surface. */
  readonly id: string;
  /** The surface boundary used to resolve nested target precedence. */
  readonly rootRef: RefObject<HTMLElement | null>;
  /** The field that receives focus when this target claims the command. */
  readonly inputRef: RefObject<HTMLInputElement | null>;
  /** Reveal a temporary search field before the provider attempts to focus it. */
  readonly onOpen?: () => void;
  /** Whether this target may currently claim the command. */
  readonly enabled?: boolean;
}

/** Commands exposed to a registered in-page search target. */
export interface InPageSearchTargetHandle {
  /** Return focus to the element that preceded the last successful search command. */
  readonly restoreFocus: () => void;
}

/** Props for {@link InPageSearchProvider}. */
export interface InPageSearchProviderProps {
  /** The application subtree whose virtualized surfaces may register search targets. */
  readonly children: ReactNode;
}

interface TargetRegistration {
  readonly token: symbol;
  readonly id: string;
  readonly getRoot: () => HTMLElement | null;
  readonly getInput: () => HTMLInputElement | null;
  readonly open: (() => void) | undefined;
  readonly isEnabled: () => boolean;
  registeredAt: number;
  lastFocusedAt: number;
  restoreElement: HTMLElement | null;
}

interface InPageSearchRegistry {
  readonly register: (target: TargetRegistration) => () => void;
  readonly restoreFocus: (target: TargetRegistration) => void;
}

const InPageSearchContext = createContext<InPageSearchRegistry | null>(null);

function isFindCommand(event: KeyboardEvent): boolean {
  return (
    event.key.toLocaleLowerCase() === 'f' &&
    event.ctrlKey !== event.metaKey &&
    !event.altKey &&
    !event.shiftKey &&
    !event.repeat
  );
}

function rootDepth(root: HTMLElement): number {
  let depth = 0;
  let current: HTMLElement | null = root;
  while (current) {
    depth += 1;
    current = current.parentElement;
  }
  return depth;
}

function focusedTargets(
  targets: Iterable<TargetRegistration>,
  focused: Element | null,
): TargetRegistration[] {
  if (!focused) return [];
  return [...targets]
    .map((target) => ({ target, root: target.getRoot(), input: target.getInput() }))
    .filter(
      (entry) =>
        entry.target.isEnabled() &&
        (entry.input === focused || entry.root?.contains(focused) === true),
    )
    .sort(
      (left, right) =>
        (right.root ? rootDepth(right.root) : 0) - (left.root ? rootDepth(left.root) : 0),
    )
    .map(({ target }) => target);
}

/**
 * Route the browser find command to the active virtualized surface.
 *
 * Native browser find remains authoritative when no registered target can focus its field.
 */
export function InPageSearchProvider({ children }: InPageSearchProviderProps): JSX.Element {
  const targetsRef = useRef(new Map<symbol, TargetRegistration>());
  const sequenceRef = useRef(0);

  const register = useCallback((target: TargetRegistration): (() => void) => {
    sequenceRef.current += 1;
    target.registeredAt = sequenceRef.current;
    targetsRef.current.set(target.token, target);
    return () => {
      targetsRef.current.delete(target.token);
    };
  }, []);

  const restoreFocus = useCallback((target: TargetRegistration): void => {
    const restoreElement = target.restoreElement;
    target.restoreElement = null;
    if (restoreElement?.isConnected) restoreElement.focus();
    const input = target.getInput();
    if (input && document.activeElement === input) input.blur();
  }, []);

  useEffect(() => {
    const handleFocus = (event: FocusEvent): void => {
      const deepest = focusedTargets(
        targetsRef.current.values(),
        event.target as Element | null,
      )[0];
      if (!deepest) return;
      sequenceRef.current += 1;
      deepest.lastFocusedAt = sequenceRef.current;
    };

    const handleFind = (event: KeyboardEvent): void => {
      if (!isFindCommand(event)) return;

      const targets = [...targetsRef.current.values()].filter((target) => target.isEnabled());
      const active = focusedTargets(targets, document.activeElement);
      const activeTokens = new Set(active.map((target) => target.token));
      const remaining = targets
        .filter((target) => !activeTokens.has(target.token))
        .sort(
          (left, right) =>
            right.lastFocusedAt - left.lastFocusedAt || right.registeredAt - left.registeredAt,
        );

      for (const target of [...active, ...remaining]) {
        const priorFocus =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const focus = (): boolean => {
          const input = target.getInput();
          if (!input?.isConnected) return false;
          input.focus();
          if (document.activeElement !== input) return false;
          if (priorFocus?.isConnected) target.restoreElement = priorFocus;
          input.select();
          return true;
        };
        if (focus()) {
          event.preventDefault();
          return;
        }
        if (!target.open) continue;
        flushSync(() => {
          target.open?.();
        });
        if (focus()) {
          event.preventDefault();
          return;
        }
      }
    };

    document.addEventListener('focusin', handleFocus);
    document.addEventListener('keydown', handleFind);
    return () => {
      document.removeEventListener('focusin', handleFocus);
      document.removeEventListener('keydown', handleFind);
    };
  }, []);

  const value = useMemo<InPageSearchRegistry>(
    () => ({ register, restoreFocus }),
    [register, restoreFocus],
  );

  return <InPageSearchContext.Provider value={value}>{children}</InPageSearchContext.Provider>;
}

/** Register one virtualized surface with the application find-command router. */
export function useInPageSearchTarget(
  options: InPageSearchTargetOptions,
): InPageSearchTargetHandle {
  const registry = useContext(InPageSearchContext);
  if (!registry) {
    throw new Error('useInPageSearchTarget must be used within an InPageSearchProvider.');
  }

  const optionsRef = useRef(options);
  optionsRef.current = options;
  const target = useMemo<TargetRegistration>(
    () => ({
      token: Symbol(options.id),
      id: options.id,
      getRoot: () => optionsRef.current.rootRef.current,
      getInput: () => optionsRef.current.inputRef.current,
      open: optionsRef.current.onOpen,
      isEnabled: () => optionsRef.current.enabled ?? true,
      registeredAt: 0,
      lastFocusedAt: 0,
      restoreElement: null,
    }),
    [options.id],
  );

  useEffect(() => {
    return registry.register(target);
  }, [registry, target]);

  const restoreFocus = useCallback((): void => {
    registry.restoreFocus(target);
  }, [registry, target]);
  return useMemo(() => ({ restoreFocus }), [restoreFocus]);
}
