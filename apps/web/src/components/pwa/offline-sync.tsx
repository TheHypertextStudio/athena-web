'use client';

import { CircleAlert, CloudOff, RefreshCw, Schedule, Trash2 } from '@docket/ui/icons';
import { Badge, Button, ControlGroup, Text } from '@docket/ui/primitives';
import { useQueryClient } from '@tanstack/react-query';
import {
  type JSX,
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from 'react';

import { useOptionalAuthenticationInterlock } from '@/components/authentication-interlock';
import { probeSession } from '@/lib/auth-client';
import { createUnauthorizedConfirmer } from '@/lib/session-recovery';
import { purgeLocalSessionState } from '@/lib/sign-out';
import { useOnlineStatus } from '@/lib/use-online-status';

import { type OutboxEntry, isManualRetryable, pendingCount, stalledCount } from './outbox-model';
import {
  discardEntry,
  isCurrentOutboxOwner,
  outboxSnapshot,
  retryEntry,
  setOutboxUser,
  startOutboxDrain,
  subscribeOutbox,
} from './outbox';

/**
 * The offline write queue's presence in the interface: one runtime, one indicator.
 *
 * @remarks
 * The requirement this exists for is a promise, and a promise has to be kept: *when data syncing is
 * involved, say the functionality comes back once the person is online again.* Saying that is only
 * honest if the queue behind it is real, which is why this file has no meaning without
 * `outbox.ts` — and why the app's standing offline banner used to say the opposite ("changes can't
 * be saved until you reconnect"). Both were changed together.
 *
 * Every string here is written by this application. Nothing derived from a response, a provider, or
 * an exception reaches the screen — a queue of failed requests is precisely where a raw
 * `TypeError: Failed to fetch` would otherwise surface.
 */

/** Subscribe a component to the queue. */
function useOutboxEntries(): readonly OutboxEntry[] {
  return useSyncExternalStore(subscribeOutbox, outboxSnapshot, emptyOutbox);
}

/** The server has no queue; rendering one during SSR would flash and then vanish. */
function emptyOutbox(): readonly OutboxEntry[] {
  return EMPTY;
}
const EMPTY: readonly OutboxEntry[] = [];

/** What the shell needs to decide whether the indicator belongs on screen. */
export interface OutboxSummary {
  /** Changes still owed to the server. */
  readonly pending: number;
  /** Changes that need a person before they can go anywhere. */
  readonly stalled: number;
}

/** Read the queue's shape without subscribing to every field of every entry. */
export function useOutboxSummary(): OutboxSummary {
  const entries = useOutboxEntries();
  return { pending: pendingCount(entries), stalled: stalledCount(entries) };
}

/**
 * Headless: binds the queue to the signed-in account and keeps it draining.
 *
 * @remarks
 * Mounted beside entity snapshot persistence because both need the resolved user id, and that is
 * the one thing the shell knows before any surface renders. The identity is also posted to
 * the service worker here, because the worker keys its offline document cache on it and cannot ask.
 *
 * After an accepted removal the whole query cache is invalidated. That looks blunt, and is
 * deliberate: after an offline session the client's idea of the world is a snapshot plus local
 * edits the server has accepted and may have adjusted. Refetching everything is the only way to be
 * sure what is on screen is what the server holds. TanStack Query coalesces overlapping refetches.
 *
 * @param props - The resolved user id, or `null` when there is no session.
 */
export function OfflineSyncRuntime({ userId }: { readonly userId: string | null }): null {
  const queryClient = useQueryClient();
  const authentication = useOptionalAuthenticationInterlock();

  useLayoutEffect(() => {
    let current = true;
    void setOutboxUser(userId).then(() => {
      if (!current) return;
      // Truthiness, not `in`: a property that exists but is undefined would otherwise throw out of
      // this effect. See the same note in `service-worker-provider.tsx`.
      const container =
        typeof navigator === 'undefined'
          ? undefined
          : (navigator as unknown as { readonly serviceWorker?: ServiceWorkerContainer })
              .serviceWorker;
      if (!container) return;
      void container.ready
        .then((registration) => {
          if (current) registration.active?.postMessage({ type: 'OFFLINE_IDENTITY', userId });
        })
        .catch(() => {
          // No worker, or registration failed. Offline documents are an enhancement; the queue
          // itself lives in IndexedDB and is unaffected.
        });
    });
    return () => {
      current = false;
    };
  }, [userId]);

  useEffect(() => {
    if (!userId) return undefined;
    let active = true;
    const isActive = (): boolean => active;
    const confirmUnauthorized = createUnauthorizedConfirmer(probeSession);
    const stop = startOutboxDrain(
      () => {
        void queryClient.invalidateQueries();
      },
      (owner) => {
        void (async () => {
          if ((await confirmUnauthorized()) !== 'session-ended') return;
          if (!isActive() || owner.userId !== userId || !isCurrentOutboxOwner(owner)) return;
          const purge = await purgeLocalSessionState(queryClient, owner);
          if (!isActive() || purge === 'superseded') return;
          if (purge === 'failed') {
            authentication?.reportSessionCleanupFailure();
            return;
          }
          authentication?.requireAuthentication(
            `${window.location.pathname}${window.location.search}`,
          );
        })();
      },
    );
    return () => {
      active = false;
      stop();
    };
  }, [authentication, queryClient, userId]);

  return null;
}

/**
 * The standing statement that queued changes exist and what will happen to them.
 *
 * @remarks
 * Rendered in the shell's banner slot, a sibling of `<main>`, so it never disturbs a page's
 * `h-full` sizing. It is not dismissible while anything is pending: dismissing it would leave
 * someone believing a change had reached the server when it had not.
 *
 * The list is collapsed by default and expands in place. Each row carries its own marker — pending
 * or needing attention — so "which of my changes has actually landed?" is answerable rather than
 * inferred from a count.
 */
export function OfflineSyncIndicator(): JSX.Element | null {
  const entries = useOutboxEntries();
  const online = useOnlineStatus();
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => {
    setExpanded((value) => !value);
  }, []);

  const pending = pendingCount(entries);
  const stalled = stalledCount(entries);
  if (pending === 0 && stalled === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="offline-sync-indicator"
      className="bg-surface-container-high text-on-surface rounded-lg px-3 py-2"
    >
      {/* `wrap`: at 390px the sentence would otherwise be squeezed into a four-word column beside
          the heading. Wrapping puts it on its own line, which is the only arrangement that stays
          readable at that width. */}
      <ControlGroup controlSize="sm" wrap>
        {stalled > 0 && pending === 0 ? (
          <CircleAlert aria-hidden="true" className="text-error shrink-0" />
        ) : (
          <CloudOff aria-hidden="true" className="text-on-surface-variant shrink-0" />
        )}
        <Text token="label-large">
          {pending > 0 ? 'Saved on this device' : 'Some changes were not sent'}
        </Text>
        <Text token="body-medium" tone="muted" className="min-w-0 flex-1 basis-64">
          {syncSentence(pending, stalled, online)}
        </Text>
        <Button variant="ghost" onClick={toggle} aria-expanded={expanded}>
          {expanded ? 'Hide changes' : 'Show changes'}
        </Button>
      </ControlGroup>
      {expanded ? (
        <ul className="mt-2 flex flex-col gap-1">
          {entries.map((entry) => (
            <OutboxRow key={entry.id} entry={entry} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * One queued change, with its own marker.
 *
 * @remarks
 * A blocked row can be tried again while its stable key remains inside the server's retention
 * window. An expired row can only be discarded because retrying the same POST after that window
 * could duplicate an already-committed command.
 */
function OutboxRow({ entry }: { readonly entry: OutboxEntry }): JSX.Element {
  const onRetry = useCallback(() => {
    void retryEntry(entry.id);
  }, [entry.id]);
  const onDiscard = useCallback(() => {
    void discardEntry(entry.id);
  }, [entry.id]);
  const settled = entry.status === 'blocked' || entry.status === 'expired';
  const retryable = isManualRetryable(entry, Date.now());

  return (
    <li>
      <ControlGroup controlSize="sm">
        <Text token="body-medium" truncate className="min-w-0 flex-1">
          {entry.label}
        </Text>
        {settled ? (
          <Badge variant="destructive" data-testid="pending-sync-marker">
            {entry.status === 'expired' ? 'Too old to send' : 'Needs attention'}
          </Badge>
        ) : (
          <Badge variant="secondary" data-testid="pending-sync-marker">
            <Schedule aria-hidden="true" className="size-3" />
            Pending sync
          </Badge>
        )}
        {entry.status === 'blocked' ? (
          <Button
            variant="ghost"
            iconOnly
            aria-label={`Try ${entry.label} again`}
            onClick={onRetry}
            disabled={!retryable}
          >
            <RefreshCw aria-hidden="true" />
          </Button>
        ) : null}
        {settled ? (
          <Button
            variant="ghost"
            iconOnly
            aria-label={`Discard ${entry.label}`}
            onClick={onDiscard}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        ) : null}
      </ControlGroup>
    </li>
  );
}

/**
 * The sentence under the heading.
 *
 * @remarks
 * Application-owned, and it changes with the two facts a person actually needs: how many changes
 * are waiting, and whether the wait is the network's fault or theirs to resolve. It never promises
 * a sync for a change that has stopped trying.
 *
 * @param pending - Changes still owed to the server.
 * @param stalled - Changes that need a person.
 * @param online - Whether the browser reports a connection.
 * @returns The sentence to render.
 */
export function syncSentence(pending: number, stalled: number, online: boolean): string {
  const changes = pending === 1 ? '1 change is' : `${String(pending)} changes are`;
  if (pending > 0 && stalled > 0) {
    return online
      ? `${changes} syncing now. ${String(stalled)} could not be sent and need you.`
      : `${changes} waiting here and will sync when you're back online. ${String(stalled)} could not be sent and need you.`;
  }
  if (pending > 0) {
    return online
      ? `${changes} syncing now.`
      : `${changes} waiting here and will sync as soon as you're back online.`;
  }
  return stalled === 1
    ? '1 change could not be sent. Review or discard it.'
    : `${String(stalled)} changes could not be sent. Review or discard them.`;
}
