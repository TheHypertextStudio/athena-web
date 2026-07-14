'use client';

/**
 * `components/canvas/node-peek` — the in-canvas selection inspector.
 *
 * @remarks
 * When a node is selected (single-click), the host renders this in a `<Panel>` so the user can
 * read the task's blockers / blocked-by / subtasks and take a quick action **without leaving the
 * canvas** (double-click navigates instead). The blocker lists are derived from the in-memory
 * edge set — no extra fetch. "Mark done / Reopen" mirrors the subtask toggle pattern
 * (`POST …/state` with the default `done`/`todo` keys); the full state picker stays on the task page.
 */
import { type ActorKind, ActorAvatar, StatusIcon } from '@docket/ui/components';
import { ArrowRight, X } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import type { Edge, Node } from '@xyflow/react';

import { PriorityGlyph } from '@/components/task-detail/PriorityGlyph';
import { stateTypeOf } from '@/lib/work-state';

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
  /** Set a task's workflow state. */
  onSetState: (id: string, state: string) => void;
  /** Dismiss the peek. */
  onClose: () => void;
}

/** A neighbor row reference. */
interface Ref {
  id: string;
  title: string;
  state: string;
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
          <StatusIcon type={stateTypeOf(r.state)} />
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
  onSetState,
  onClose,
}: NodePeekProps): React.JSX.Element {
  const data = node.data as TaskNodeData;
  const byId = new Map(nodes.map((n) => [n.id, n.data as TaskNodeData]));
  const toRef = (id: string): Ref => {
    const d = byId.get(id);
    return { id, title: d?.title ?? 'Task', state: d?.state ?? 'backlog' };
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

  const isDone = stateTypeOf(data.state) === 'completed';
  const assignee: { name: string; kind: ActorKind; avatarUrl?: string | null } | null =
    data.assignee;

  return (
    <div className="border-outline-variant bg-surface-container flex w-72 flex-col gap-3 rounded-xl border p-3 shadow-lg">
      <div className="flex items-start gap-2">
        <StatusIcon type={stateTypeOf(data.state)} className="mt-0.5" />
        <span className="text-on-surface text-body-medium flex-1 font-medium">{data.title}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-on-surface-variant hover:text-on-surface"
        >
          <X className="size-4" />
        </button>
      </div>

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

      <div className="border-outline-variant flex items-center gap-2 border-t pt-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="gap-1"
          onClick={() => {
            onNavigate(node.id);
          }}
        >
          Open task <ArrowRight className="size-3.5" />
        </Button>
        {canEdit ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={() => {
              onSetState(node.id, isDone ? 'todo' : 'done');
            }}
          >
            {isDone ? 'Reopen' : 'Mark done'}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
