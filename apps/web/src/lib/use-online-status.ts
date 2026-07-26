'use client';

import { useSyncExternalStore } from 'react';

/**
 * Whether the browser currently believes it has a network connection.
 *
 * @remarks
 * `useSyncExternalStore` rather than `useState` + `useEffect`, mirroring
 * `packages/ui/src/hooks/useMediaQuery.tsx`: it subscribes without an extra render pass and gives
 * React a correct server snapshot, so the value never flickers during hydration.
 *
 * **This drives presentation, never authorization.** `navigator.onLine` answers "is there a network
 * interface up?", not "can I reach Docket?" — it is `true` behind a captive portal and `true` on a
 * LAN with no upstream route. Use it to word a banner, to enable a retry button, or to decide when
 * to re-run a request; never to decide whether someone is signed in. That decision belongs to
 * {@link file://./session-status.ts}, which distinguishes the cases from the request itself.
 *
 * The server snapshot is `true` so SSR and the first client paint agree on the common case and no
 * offline banner flashes on a perfectly healthy load.
 *
 * @returns `true` when the browser reports a connection.
 */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener('online', onStoreChange);
  window.addEventListener('offline', onStoreChange);
  return () => {
    window.removeEventListener('online', onStoreChange);
    window.removeEventListener('offline', onStoreChange);
  };
}

function getSnapshot(): boolean {
  return navigator.onLine;
}

function getServerSnapshot(): boolean {
  return true;
}
