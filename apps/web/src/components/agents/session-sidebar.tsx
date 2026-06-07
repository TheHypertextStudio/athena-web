'use client';

/**
 * The RIGHT column of the Session view (mvp-plan §8.6): the receipt of what *changed* this
 * session, the accountability line, and the session controls.
 *
 * @remarks
 * Three stacked sections:
 *
 * - **Changes this session** — the receipt. Every `action` activity in the stream, with its
 *   summary and resolved approval state, so a reviewer can see exactly what the agent did (or
 *   proposes to do) without scrolling the full transcript.
 * - **Accountability** — `<agent> · on behalf of <owner>`, the principal-vs-initiator line that
 *   makes agent work answerable to a named human.
 * - **Controls** — [Pause] / [Take over] / [Cancel session], enabled per the session's
 *   lifecycle. The page owns the RPC + pending state; this component fires the callbacks.
 *
 * Token-only colors; calm, transparent presentation.
 */
import type { SessionActivityOut, SessionStatus } from '@docket/types';
import { ActorAvatar } from '@docket/ui/components';
import { CheckCircle2, Sparkles, XCircle } from '@docket/ui/icons';
import { Badge, Button, Separator } from '@docket/ui/primitives';
import type { JSX } from 'react';

/** A condensed view-model of one `action` activity for the changes receipt. */
export interface ChangeReceiptItem {
  /** The activity id. */
  id: string;
  /** The action kind (e.g. `update_task`). */
  kind: string;
  /** The human-readable summary. */
  summary: string;
  /** The approval state, when gated. */
  approvalStatus: SessionActivityOut['approvalStatus'] | null;
}

/** The session-lifecycle actions the reviewer may drive from the controls. */
export interface SessionControlsState {
  /** Whether [Pause] is available (only a running session). */
  canPause: boolean;
  /** Whether [Take over] (resume) is available (only an awaiting-input session). */
  canTakeOver: boolean;
  /** Whether [Cancel session] is available (any non-terminal session). */
  canCancel: boolean;
}

/** Props for {@link SessionSidebar}. */
export interface SessionSidebarProps {
  /** The session's current lifecycle status (drives the controls availability copy). */
  status: SessionStatus;
  /** The agent's display name. */
  agentName: string;
  /** The agent's avatar URL, when known. */
  agentAvatarUrl?: string | null;
  /** The accountable owner's display name, or `null` when unattributed. */
  ownerName: string | null;
  /** The session initiator's display name (who kicked it off), or `null`. */
  initiatorName: string | null;
  /** The change receipt (every `action`), newest-last to mirror the stream order. */
  changes: readonly ChangeReceiptItem[];
  /** Which controls are available, given the lifecycle. */
  controls: SessionControlsState;
  /** Whether a control RPC (pause/resume/cancel) is in flight. */
  controlPending: boolean;
  /** Pause the session. */
  onPause: () => void;
  /** Take over (resume) the session. */
  onTakeOver: () => void;
  /** Cancel the session. */
  onCancel: () => void;
}

/**
 * The Session view's accountability + changes + controls sidebar.
 */
export function SessionSidebar({
  status,
  agentName,
  agentAvatarUrl,
  ownerName,
  initiatorName,
  changes,
  controls,
  controlPending,
  onPause,
  onTakeOver,
  onCancel,
}: SessionSidebarProps): JSX.Element {
  const noControls = !controls.canPause && !controls.canTakeOver && !controls.canCancel;

  return (
    <aside className="flex flex-col gap-6">
      {/* Changes this session — the receipt. */}
      <section aria-labelledby="changes-heading" className="flex flex-col gap-2">
        <h2
          id="changes-heading"
          className="text-muted-foreground text-xs font-medium tracking-wide uppercase"
        >
          Changes this session
        </h2>
        {changes.length === 0 ? (
          <p className="text-muted-foreground border-border rounded-lg border border-dashed p-3 text-xs">
            No changes yet. The agent hasn’t proposed or made any changes.
          </p>
        ) : (
          <ul className="divide-border border-border flex flex-col divide-y overflow-hidden rounded-lg border">
            {changes.map((change) => (
              <li key={change.id} className="flex items-start justify-between gap-2 p-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <code className="text-muted-foreground text-[0.625rem] tracking-wide uppercase">
                    {change.kind}
                  </code>
                  <p className="text-foreground text-xs leading-snug">{change.summary}</p>
                </div>
                <ChangeState status={change.approvalStatus} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Accountability. */}
      <section aria-labelledby="accountability-heading" className="flex flex-col gap-2">
        <h2
          id="accountability-heading"
          className="text-muted-foreground text-xs font-medium tracking-wide uppercase"
        >
          Accountability
        </h2>
        <div className="border-border flex flex-col gap-3 rounded-lg border p-3">
          <div className="flex items-center gap-2">
            <ActorAvatar kind="agent" name={agentName} avatarUrl={agentAvatarUrl} size={28} />
            <div className="flex min-w-0 flex-col">
              <span className="text-foreground truncate text-sm font-medium">{agentName}</span>
              <span className="text-muted-foreground text-xs">
                {ownerName ? `on behalf of ${ownerName}` : 'no accountable owner'}
              </span>
            </div>
          </div>
          {initiatorName ? (
            <>
              <Separator />
              <p className="text-muted-foreground text-xs">
                Started by <span className="text-foreground/80 font-medium">{initiatorName}</span>
              </p>
            </>
          ) : null}
        </div>
      </section>

      {/* Controls. */}
      <section aria-labelledby="controls-heading" className="flex flex-col gap-2">
        <h2
          id="controls-heading"
          className="text-muted-foreground text-xs font-medium tracking-wide uppercase"
        >
          Controls
        </h2>
        {noControls ? (
          <p className="text-muted-foreground text-xs">
            This session is {status.replace(/_/g, ' ')} — nothing to control.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {controls.canPause ? (
              <Button
                variant="outline"
                size="sm"
                disabled={controlPending}
                onClick={onPause}
                className="justify-start"
              >
                Pause
              </Button>
            ) : null}
            {controls.canTakeOver ? (
              <Button
                variant="outline"
                size="sm"
                disabled={controlPending}
                onClick={onTakeOver}
                className="justify-start"
              >
                Take over
              </Button>
            ) : null}
            {controls.canCancel ? (
              <Button
                variant="outline"
                size="sm"
                disabled={controlPending}
                onClick={onCancel}
                className="text-destructive hover:text-destructive justify-start"
              >
                Cancel session
              </Button>
            ) : null}
          </div>
        )}
      </section>
    </aside>
  );
}

/** A compact approval-state marker for a change-receipt row. */
function ChangeState({
  status,
}: {
  status: SessionActivityOut['approvalStatus'] | null;
}): JSX.Element | null {
  switch (status) {
    case 'proposed':
      return (
        <Badge
          variant="outline"
          className="border-primary/40 text-primary shrink-0 gap-1 text-[0.625rem]"
        >
          <Sparkles className="h-2.5 w-2.5" /> Proposed
        </Badge>
      );
    case 'approved':
    case 'applied':
      return (
        <Badge
          variant="outline"
          className="text-state-completed border-state-completed/40 shrink-0 gap-1 text-[0.625rem]"
        >
          <CheckCircle2 className="h-2.5 w-2.5" /> {status === 'applied' ? 'Applied' : 'Approved'}
        </Badge>
      );
    case 'rejected':
      return (
        <Badge
          variant="outline"
          className="text-destructive border-destructive/40 shrink-0 gap-1 text-[0.625rem]"
        >
          <XCircle className="h-2.5 w-2.5" /> Rejected
        </Badge>
      );
    default:
      return null;
  }
}
