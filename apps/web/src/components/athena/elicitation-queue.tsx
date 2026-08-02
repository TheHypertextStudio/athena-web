'use client';

/**
 * Everything Athena is waiting on, in the conversation where she asked it.
 *
 * @remarks
 * Mounted inside the Athena surface rather than given a page of its own, because a question exists
 * to unblock work you are already looking at — a separate inbox of questions would recreate exactly
 * the context-hunting the product deletes.
 *
 * The component owns three responsibilities the cards deliberately do not:
 *
 * - **Presence.** While it is mounted and the tab is focused, the server knows you are reachable,
 *   which is what makes a new question live rather than a notification.
 * - **Liveness.** It re-reads on a short live poll, so a question raised by an agent working in the
 *   background appears here without a refresh.
 * - **Landing.** `?elicitation=<id>` (the path a notification's body-click lands on) scrolls that
 *   question into view and rings it, so arriving from a banner puts you on the question, in the
 *   context of its task, rather than at the top of a list.
 */
import type { ElicitationOut } from '@docket/types';
import { Inbox } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { Skeleton, Text } from '@docket/ui/primitives';
import { type JSX, useEffect, useRef, useState } from 'react';

import { ElicitationCard } from './elicitation-card';
import { useAthenaPresence, useLiveElicitations } from './elicitation-data';
import { EnableNotificationsPrompt } from './elicitation-notifications';

/** Props for {@link ElicitationQueue}. */
export interface ElicitationQueueProps {
  /** The workspace whose uploads a file answer is stored in. */
  readonly organizationId?: string | null;
  /** Show recently settled questions under the pending ones. */
  readonly showSettled?: boolean;
  /** Extra class names for the root element. */
  readonly className?: string;
}

/**
 * The workspace one question's own task lives in, read off its link.
 *
 * @remarks
 * A file answer is stored as an attachment on that task, so the upload has to target the task's
 * workspace — not whichever workspace the surrounding surface happens to be filtered to. Reading it
 * from the server-rendered link keeps the two in step by construction.
 */
function workspaceOf(elicitation: ElicitationOut): string | null {
  return /^\/orgs\/([^/]+)\//.exec(elicitation.task.href)?.[1] ?? null;
}

/** Render the caller's open questions, live. */
export function ElicitationQueue({
  organizationId = null,
  showSettled = true,
  className,
}: ElicitationQueueProps): JSX.Element | null {
  const { pending, settled, loading, failed } = useLiveElicitations();
  const [target, setTarget] = useState<string | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);

  useAthenaPresence();

  // Read from `location` rather than `useSearchParams`: this component is mounted inside surfaces
  // that are not otherwise client-navigation-aware, and `useSearchParams` both requires a Suspense
  // boundary in the App Router and throws outright when the component is rendered without a router
  // (which is exactly how its host is unit-tested). The landing behaviour is a one-shot scroll, so
  // a mount-time read is all it needs.
  useEffect(() => {
    setTarget(new URLSearchParams(window.location.search).get('elicitation'));
  }, []);

  useEffect(() => {
    if (!target) return;
    const card = containerRef.current?.querySelector(`[data-elicitation="${target}"]`);
    card?.scrollIntoView({ block: 'center' });
  }, [target, pending.length]);

  if (loading) {
    return (
      <section
        aria-label="What Athena is waiting on"
        className={cn('flex flex-col gap-3', className)}
      >
        {/* placeholder: how many questions are open and how tall each card is. The surface around
            it is already painted and interactive. */}
        <Skeleton className="h-40 w-full rounded-xl" />
      </section>
    );
  }

  if (failed) {
    return (
      <section aria-label="What Athena is waiting on" className={className}>
        <Text token="body-medium" tone="muted" role="status">
          Could not load what Athena is waiting on. We&apos;ll keep checking.
        </Text>
      </section>
    );
  }

  const visibleSettled = showSettled ? settled.slice(0, 3) : [];
  if (pending.length === 0 && visibleSettled.length === 0) return null;

  return (
    <section
      ref={containerRef}
      aria-label="What Athena is waiting on"
      className={cn('flex flex-col gap-3', className)}
    >
      <EnableNotificationsPrompt
        relevant={pending.some((elicitation) => elicitation.timeSensitive)}
      />
      {pending.map((elicitation) => (
        <ElicitationCard
          key={elicitation.id}
          elicitation={elicitation}
          organizationId={workspaceOf(elicitation) ?? organizationId}
          focused={elicitation.id === target}
        />
      ))}
      {visibleSettled.length > 0 ? (
        <div className="flex flex-col gap-2">
          <div className="text-on-surface-variant flex items-center gap-1.5">
            <Inbox aria-hidden="true" className="size-4" />
            <Text token="label-medium" tone="muted">
              Recently decided
            </Text>
          </div>
          {visibleSettled.map((elicitation) => (
            <ElicitationCard
              key={elicitation.id}
              elicitation={elicitation}
              organizationId={workspaceOf(elicitation) ?? organizationId}
              focused={elicitation.id === target}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
