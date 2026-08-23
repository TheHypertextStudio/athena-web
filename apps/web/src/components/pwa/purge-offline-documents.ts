'use client';

/**
 * Tell the service worker to forget every cached route document and who they belonged to.
 *
 * @remarks
 * The page-side half of the sign-out teardown. `purgeLocalSessionState` already clears the
 * in-memory query cache, the offline identity snapshot, and every persisted entity bucket; once
 * the worker began storing route documents (see `service-worker/documents.ts`) it became a fourth
 * place a previous occupant's data can live, and sign-out has to mean one thing.
 *
 * Two mechanisms, because either alone has a hole. The message reaches the worker that is currently
 * controlling the page and lets it clear the identity as well as the documents. The direct
 * `caches.delete` covers the case where no worker is controlling this page at all — a first load
 * after registration, a browser that revoked the registration — where the documents would otherwise
 * outlive the session with nobody to ask.
 *
 * Failures are swallowed on purpose: this runs on the way to a redirect and must never be what
 * stops someone signing out.
 */
export async function purgeOfflineDocuments(): Promise<void> {
  try {
    // Truthiness, not `in`: see the note in `service-worker-provider.tsx`.
    const container =
      typeof navigator === 'undefined'
        ? undefined
        : (navigator as unknown as { readonly serviceWorker?: ServiceWorkerContainer })
            .serviceWorker;
    container?.controller?.postMessage({ type: 'PURGE_PRIVATE' });
    if (typeof caches !== 'undefined') {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('docket-documents-') || name === 'docket-identity')
          .map((name) => caches.delete(name)),
      );
    }
  } catch {
    /* Storage unavailable or already gone. Nothing reachable to purge. */
  }
}
