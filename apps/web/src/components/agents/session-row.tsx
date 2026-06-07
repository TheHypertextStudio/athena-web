'use client';

/**
 * One row in the Agents (sessions) feed.
 *
 * @remarks
 * Each row is the at-a-glance summary of one agent session: the task it is working
 * (leading, prominent), the agent doing the work with its accountable owner
 * (`<agent> · on behalf of <owner>`), a token-colored {@link SessionStatusPill}, and a
 * when/how-long stamp (relative start, plus an elapsed span for in-flight or just-settled
 * runs). The whole row is a button that opens the Session view; it carries a focus ring and
 * keyboard activation (Enter/Space) so the feed is fully navigable without a mouse.
 */
import type { SessionStatus } from '@docket/types';
import { ActorAvatar } from '@docket/ui/components';
import { cn } from '@docket/ui/lib/utils';
import type { JSX } from 'react';

import { elapsed, relativeTime } from './format-time';
import { SessionStatusPill } from './session-status';

/** The view-model one feed row renders. */
export interface SessionRowData {
  /** Stable session id. */
  id: string;
  /** The task brief the agent is working (its title, or a fallback when unlinked). */
  taskTitle: string;
  /** The agent's display name. */
  agentName: string;
  /** The agent's avatar URL, when known. */
  agentAvatarUrl?: string | null;
  /** The accountable human owner's display name, or `null` when unattributed. */
  ownerName: string | null;
  /** The session lifecycle status. */
  status: SessionStatus;
  /** ISO start timestamp, or `null` when the run has not begun. */
  startedAt: string | null;
  /** ISO end timestamp, or `null` for a still-running session. */
  endedAt: string | null;
  /** ISO created timestamp (used as the when-stamp fallback before a run starts). */
  createdAt: string;
}

/** Props for {@link SessionRow}. */
export interface SessionRowProps {
  /** The row's view-model. */
  session: SessionRowData;
  /** Open the Session view for this row. */
  onOpen: (sessionId: string) => void;
}

/**
 * A single agent-session feed row — task, agent + owner, status, and timing.
 *
 * @example
 * ```tsx
 * <SessionRow session={row} onOpen={openSession} />
 * ```
 */
export function SessionRow({ session, onOpen }: SessionRowProps): JSX.Element {
  const startStamp = relativeTime(session.startedAt ?? session.createdAt);
  const span = elapsed(session.startedAt, session.endedAt);
  const inFlight = session.endedAt === null && session.startedAt !== null;

  return (
    <button
      type="button"
      onClick={() => {
        onOpen(session.id);
      }}
      className={cn(
        'group focus-visible:ring-ring flex w-full items-center gap-4 rounded-lg px-4 py-3 text-left',
        'hover:bg-muted/50 transition-colors outline-none focus-visible:ring-1',
      )}
    >
      {/* Agent identity. */}
      <ActorAvatar
        kind="agent"
        name={session.agentName}
        avatarUrl={session.agentAvatarUrl}
        size={28}
      />

      {/* Task + attribution. */}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-foreground truncate text-sm font-medium">{session.taskTitle}</span>
        <span className="text-muted-foreground truncate text-xs">
          <span className="text-foreground/80 font-medium">{session.agentName}</span>
          {session.ownerName ? (
            <>
              {' · on behalf of '}
              <span className="text-foreground/80 font-medium">{session.ownerName}</span>
            </>
          ) : null}
        </span>
      </span>

      {/* Status pill. */}
      <SessionStatusPill status={session.status} />

      {/* When + how long. */}
      <span className="text-muted-foreground hidden w-28 shrink-0 flex-col items-end gap-0.5 text-right text-xs sm:flex">
        <span>{startStamp}</span>
        {span ? (
          <span className="tabular-nums">
            {inFlight ? 'running ' : 'ran '}
            {span}
          </span>
        ) : null}
      </span>
    </button>
  );
}
