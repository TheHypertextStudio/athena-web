'use client';

import { useSyncExternalStore, type JSX, type ReactNode } from 'react';
import { Button } from '../../primitives/button';

const subscribe = (): (() => void) => () => undefined;
const clientReady = (): boolean => true;
const serverReady = (): boolean => false;

/** Keep a client-controlled shell launcher unavailable until its event handler has hydrated. */
export function ShellMobileTrigger({
  label,
  expanded,
  controls,
  onOpen,
  children,
}: {
  readonly label: string;
  readonly expanded: boolean;
  readonly controls?: string;
  readonly onOpen: () => void;
  readonly children: ReactNode;
}): JSX.Element {
  // Match the server's disabled button during hydration, then expose the working control.
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady);
  return (
    <Button
      type="button"
      variant="ghost"
      controlSize="md"
      iconOnly
      aria-label={label}
      aria-expanded={expanded}
      aria-controls={controls}
      disabled={!ready}
      className="shrink-0 rounded-lg [&_svg]:size-5"
      onClick={onOpen}
    >
      {children}
    </Button>
  );
}
