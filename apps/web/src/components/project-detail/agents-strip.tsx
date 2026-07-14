'use client';

/**
 * The "agents here" strip — surfaces agent sessions targeting tasks in this project.
 *
 * @remarks
 * Agent sessions are scoped to a Task (`AgentSessionOut.taskId`), not to a Project, so the
 * page filters the org's sessions down to those whose task belongs to this project and
 * passes them here already resolved to a display row ({@link AgentHere}). The strip only
 * renders when at least one such session exists, putting a face on the autonomous work
 * happening inside the project. Each entry shows the agent (an {@link ActorAvatar} with the
 * agent shape), the task it is working, and a status pill colored by the session lifecycle —
 * with `awaiting_approval` / `awaiting_input` called out since they need a human.
 */
import type { SessionStatus } from '@docket/types';
import { cn } from '@docket/ui';
import { ActorAvatar } from '@docket/ui/components';
import { Sparkles } from '@docket/ui/icons';
import type { JSX } from 'react';

/** A session targeting this project, resolved to display fields. */
export interface AgentHere {
  /** The session id (row key). */
  readonly sessionId: string;
  /** The agent's display name. */
  readonly agentName: string;
  /** The title of the task the session is working. */
  readonly taskTitle: string;
  /** The session lifecycle status. */
  readonly status: SessionStatus;
}

/** Human-readable label for each session status. */
const STATUS_LABEL: Record<SessionStatus, string> = {
  pending: 'Queued',
  running: 'Running',
  awaiting_input: 'Needs input',
  awaiting_approval: 'Needs approval',
  completed: 'Completed',
  failed: 'Failed',
  canceled: 'Canceled',
};

/** Token classes for each session-status pill (active vs needs-human vs terminal). */
const STATUS_CLASS: Record<SessionStatus, string> = {
  pending: 'text-on-surface-variant bg-surface-container ring-outline-variant',
  running: 'text-state-started bg-state-started/10 ring-state-started/30',
  awaiting_input: 'text-state-canceled bg-state-canceled/10 ring-state-canceled/30',
  awaiting_approval: 'text-state-canceled bg-state-canceled/10 ring-state-canceled/30',
  completed: 'text-state-completed bg-state-completed/10 ring-state-completed/30',
  failed: 'text-destructive bg-destructive/10 ring-destructive/30',
  canceled: 'text-on-surface-variant bg-surface-container ring-outline-variant',
};

/** Whether a status should pulse to draw the eye (live or human-blocked). */
function isLive(status: SessionStatus): boolean {
  return status === 'running' || status === 'awaiting_approval' || status === 'awaiting_input';
}

/** Props for {@link AgentsStrip}. */
export interface AgentsStripProps {
  /** The sessions targeting this project (already resolved). */
  agents: readonly AgentHere[];
}

/**
 * The agents-here strip; renders nothing when no agent session targets the project.
 *
 * @param props - The {@link AgentsStripProps}.
 * @returns the rendered strip, or `null` when empty.
 */
export function AgentsStrip({ agents }: AgentsStripProps): JSX.Element | null {
  if (agents.length === 0) return null;
  return (
    <section
      aria-label="Agents working here"
      className="border-primary/30 bg-primary/[0.04] flex flex-col gap-3 rounded-xl border p-4"
    >
      <div className="flex items-center gap-2">
        <Sparkles aria-hidden="true" className="text-primary size-4" />
        <h2 className="text-on-surface text-body-medium font-semibold">Agents working here</h2>
        <span className="text-on-surface-variant text-xs tabular-nums">{agents.length}</span>
      </div>
      <ul className="flex flex-col gap-2">
        {agents.map((agent) => (
          <li
            key={agent.sessionId}
            className="bg-surface-container-low border-outline-variant flex items-center gap-3 rounded-lg border px-3 py-2"
          >
            <ActorAvatar kind="agent" name={agent.agentName} size={28} />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-on-surface text-body-medium truncate font-medium">
                {agent.agentName}
              </span>
              <span className="text-on-surface-variant truncate text-xs">
                Working <span className="text-on-surface">{agent.taskTitle}</span>
              </span>
            </div>
            <span
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset',
                STATUS_CLASS[agent.status],
              )}
            >
              {isLive(agent.status) ? (
                <span aria-hidden="true" className="relative flex size-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-75" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-current" />
                </span>
              ) : null}
              {STATUS_LABEL[agent.status]}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
