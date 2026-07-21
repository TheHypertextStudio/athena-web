'use client';

import {
  ActorAvatar,
  type ActorKind,
  ListCell,
  ListRow,
  StatusIcon,
  type WorkflowStateType,
} from '@docket/ui/components';
import type { JSX } from 'react';

import { EditableTitle } from '@/components/editor/editable-title';

import { LiveSessionPill, type PillStatus } from './live-session-pill';

/** The actor (assignee or agent delegate) shown on the trailing edge of a row. */
export interface RowActor {
  /** Display name for the avatar + accessible label. */
  name: string;
  /** Actor kind, driving the avatar shape (human / agent / team). */
  kind: ActorKind;
  /** Optional avatar image URL. */
  avatarUrl?: string | null;
}

/** The view-model one agent-aware work row renders. */
export interface AgentTaskRowData {
  /** Stable task id. */
  id: string;
  /** Task title. */
  title: string;
  /** Canonical workflow-state type driving the leading status glyph. */
  stateType: WorkflowStateType;
  /** The trailing actor (the assignee on "mine", the agent delegate on "delegated"). */
  actor?: RowActor | null;
  /** The live agent session pill, when a session is driving this task. */
  session?: { status: PillStatus; href: string } | null;
}

/** Props for {@link AgentTaskRow}. */
export interface AgentTaskRowProps {
  /** The row view-model. */
  task: AgentTaskRowData;
  /** Whether the row is the active (keyboard-focused) row. */
  active?: boolean;
  /** Activate (open) the task. In `doubleClick`-edit mode a single click on the title runs this. */
  onActivate?: () => void;
  /** Whether the viewer may rename the task in place (double-click the title). */
  canEdit?: boolean;
  /** Persist a renamed task title. Enables inline rename when provided with `canEdit`. */
  onRename?: (taskId: string, title: string) => void;
}

/**
 * A work-view task row that surfaces its driving agent session.
 *
 * @remarks
 * Extends the canonical {@link import('@docket/ui/components').TaskRow | TaskRow} anatomy —
 * leading {@link StatusIcon}, title, trailing {@link ActorAvatar} — with a
 * {@link LiveSessionPill} between the title and the actor avatar so an agent-run task reads
 * its live state (running / awaiting approval / paused / errored) at a glance and links
 * straight to the task detail / session. Composed from {@link ListRow} + {@link ListCell}
 * (rather than the preset `TaskRow`) precisely because the preset has no slot for the pill.
 * The avatar encodes the actor's kind by shape, so an agent delegate is visually distinct
 * from a human assignee without a legend.
 */
export function AgentTaskRow({
  task,
  active,
  onActivate,
  canEdit,
  onRename,
}: AgentTaskRowProps): JSX.Element {
  return (
    <ListRow active={active} onActivate={onActivate}>
      <ListCell className="shrink-0">
        <StatusIcon type={task.stateType} />
      </ListCell>
      <ListCell className="flex-1">
        {canEdit && onRename ? (
          <EditableTitle
            value={task.title}
            onSave={(title) => {
              onRename(task.id, title);
            }}
            canEdit
            activate="doubleClick"
            {...(onActivate ? { onActivate } : {})}
            ariaLabel="Task title"
            className="text-on-surface truncate"
          />
        ) : (
          <span className="text-on-surface truncate">{task.title}</span>
        )}
      </ListCell>
      {task.session ? (
        <ListCell className="shrink-0">
          <LiveSessionPill status={task.session.status} href={task.session.href} />
        </ListCell>
      ) : null}
      {task.actor ? (
        <ListCell className="shrink-0">
          <ActorAvatar
            kind={task.actor.kind}
            name={task.actor.name}
            avatarUrl={task.actor.avatarUrl}
          />
        </ListCell>
      ) : null}
    </ListRow>
  );
}
