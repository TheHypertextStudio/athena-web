'use client';
import { useEffect, useRef } from 'react';

/** Clear workspace-owned draft references only after a real destination change. */
export function useComposerWorkspaceReset(
  host: { targetWorkspaceId: string | null; initialWorkspaceId: string | null } | undefined,
  reset: () => void,
  retainInitialResolution = true,
): void {
  const previous = useRef(host?.targetWorkspaceId ?? null);
  useEffect(() => {
    if (!host || previous.current === host.targetWorkspaceId) return;
    const prior = previous.current;
    previous.current = host.targetWorkspaceId;
    if (
      retainInitialResolution &&
      prior === null &&
      host.targetWorkspaceId !== null &&
      host.targetWorkspaceId === host.initialWorkspaceId
    )
      return;
    reset();
  }, [host, reset, retainInitialResolution]);
}
