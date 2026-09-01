'use client';

/**
 * `components/canvas/node-peek` — the in-canvas selection inspector.
 *
 * @remarks
 * When a node is selected (single-click), the host docks this beside the canvas so the user can
 * read the task's blockers / blocked-by / subtasks and take a quick action **without leaving the
 * canvas** (double-click navigates instead). The blocker lists are derived from the in-memory
 * edge set — no extra fetch. "Mark done / Reopen" moves the task between the workspace's own
 * completed and default statuses, resolved by the host; the full status picker stays on the task
 * page.
 */
import { type ActorKind, ActorAvatar, StatusIcon } from '@docket/ui/components';
import { ArrowRight } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import type { Edge, Node } from '@xyflow/react';

import type { WorkStatusCategory } from '@docket/work/work-status-contract';

import { PriorityGlyph } from '@/components/task-detail/PriorityGlyph';

import { CanvasInspector } from './canvas-inspector';

import type { TaskNodeData } from './task-node';

/** Props for {@link NodePeek}. */
export interface NodePeekProps {
  /** The selected node. */
  node: Node;
  /** All nodes (to resolve neighbor titles/states). */
  nodes: readonly Node[];
  /** All edges (to derive blockers / blocked-by / subtasks). */
  edges: readonly Edge[];
  /** Whether quick edits are allowed (`contribute`). */
  canEdit: boolean;
  /** Navigate to a task's detail page. */
  onNavigate: (id: string) => void;
  /** Move a task into or out of its workspace's completed status. */
  onSetComplete: (id: string, complete: boolean) => void;
  /** Dismiss the peek. */
  onClose: () => void;
}

/** A neighbor row reference. */
interface Ref {
  id: string;
  title: string;
  statusName: string | undefined;
  stateType: WorkStatusCategory;
}

/** A compact list of related tasks with status glyphs. */
function RefList({
  label,
  refs,
  onNavigate,
}: {
  label: string;
  refs: readonly Ref[];
  onNavigate: (id: string) => void;
}): React.JSX.Element | null {
  if (refs.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-on-surface-variant text-xs font-medium">{label}</span>
      {refs.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => {
            onNavigate(r.id);
          }}
          className="hover:bg-surface-container-high flex items-center gap-1.5 rounded px-1 py-0.5 text-left"
        >
          <StatusIcon type={r.stateType} label={r.statusName} />
          <span className="text-on-surface text-body-medium truncate">{r.title}</span>
        </button>
      ))}
    </div>
  );
}

/** The selection inspector card. */
export default function NodePeek({
  node,
  nodes,
  edges,
  canEdit,
  onNavigate,
  onSetComplete,
  onClose,
}: NodePeekProps): React.JSX.Element {
  const data = node.data as TaskNodeData;
  const byId = new Map(nodes.map((n) => [n.id, n.data as TaskNodeData]));
  const toRef = (id: string): Ref => {
    const d = byId.get(id);
    return {
      id,
      title: d?.title ?? 'Task',
      statusName: d?.statusName,
      stateType: d?.stateType ?? 'backlog',
    };
  };

  const blockedBy = edges
    .filter((e) => (e.data as { kind?: string }).kind === 'dependency' && e.target === node.id)
    .map((e) => toRef(e.source));
  const blocking = edges
    .filter((e) => (e.data as { kind?: string }).kind === 'dependency' && e.source === node.id)
    .map((e) => toRef(e.target));
  const subtasks = edges
    .filter((e) => (e.data as { kind?: string }).kind === 'subtask' && e.source === node.id)
    .map((e) => toRef(e.target));

  const isDone = data.stateType === 'completed';
  const assignee: { name: string; kind: ActorKind; avatarUrl?: string | null } | null =
    data.assignee;

  return (
    <CanvasInspector
      title={data.title}
      leading={<StatusIcon type={data.stateType} label={data.statusName} />}
      closeLabel="Close task details"
      onClose={onClose}
    >
      <div className="flex flex-col gap-3">
        <div className="text-on-surface-variant flex items-center gap-3 text-xs">
          {data.priority !== 'none' ? (
            <span className="flex items-center gap-1">
              <PriorityGlyph priority={data.priority} />
              {data.priority}
            </span>
          ) : null}
          {assignee !== null ? (
            <span className="flex items-center gap-1">
              <ActorAvatar
                kind={assignee.kind}
                name={assignee.name}
                avatarUrl={assignee.avatarUrl}
                size={18}
              />
              {assignee.name}
            </span>
          ) : (
            <span>Unassigned</span>
          )}
        </div>

        <RefList label="Blocked by" refs={blockedBy} onNavigate={onNavigate} />
        <RefList label="Blocks" refs={blocking} onNavigate={onNavigate} />
        <RefList label="Subtasks" refs={subtasks} onNavigate={onNavigate} />

        <div className="flex items-center gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="gap-1"
            onClick={() => {
              onNavigate(node.id);
            }}
          >
            Open task <ArrowRight className="size-4" />
          </Button>
          {canEdit ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="ml-auto"
              onClick={() => {
                onSetComplete(node.id, !isDone);
              }}
            >
              {isDone ? 'Reopen' : 'Mark done'}
            </Button>
          ) : null}
        </div>
      </div>
    </CanvasInspector>
  );
}
