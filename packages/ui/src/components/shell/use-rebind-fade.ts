'use client';

import * as React from 'react';

/** How long the main panel's cross-fade runs when the bound organization changes. */
const REBIND_FADE_MS = 240;

/**
 * Whether the main panel is mid cross-fade after the bound organization changed.
 *
 * @remarks
 * A transient flag rather than a key-based remount, which would destroy route and page state. The
 * first mount never fades: there is nothing to cross from.
 *
 * @param activeOrgId - The organization the shell is bound to.
 */
export function useRebindFade(activeOrgId: string | null): boolean {
  const [rebinding, setRebinding] = React.useState(false);
  const previous = React.useRef(activeOrgId);
  React.useEffect(() => {
    if (previous.current === activeOrgId) return undefined;
    const previousOrgId = previous.current;
    previous.current = activeOrgId;
    if (previousOrgId === null) return undefined;
    setRebinding(true);
    const timer = setTimeout(() => {
      setRebinding(false);
    }, REBIND_FADE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [activeOrgId]);
  return rebinding;
}
