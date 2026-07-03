'use client';

/**
 * One pending proposal group — the batch-review card (mvp-plan §8.6; the ghost system's
 * session-side surface).
 *
 * @remarks
 * A group is everything the agent proposed in ONE turn ("create these 3 tasks"), so it
 * reviews as a unit: a checkbox per member, inline title editing for ghosts (the edit
 * PATCHes the stored tool input — approval executes exactly what is shown), and
 * `Approve all` / `Approve selected` / `Reject all`. Each ghost row carries a stable
 * `view-transition-name` keyed by its activity id, so when approval materializes the
 * real task the browser can morph ghost → row instead of swapping views.
 */
import type { ProposalGroupOut, ProposalItemOut } from '@docket/types';
import { cn } from '@docket/ui/lib/utils';
import { Button } from '@docket/ui/primitives';
import { type JSX, useState } from 'react';

/** Props for {@link ProposalGroupCard}. */
export interface ProposalGroupCardProps {
  /** The pending group to review. */
  group: ProposalGroupOut;
  /** Whether the reviewer may decide/edit (the `assign` bar). */
  canAct: boolean;
  /** Whether a decision for this session is in flight. */
  pending: boolean;
  /** Decide the whole group or the checked subset. */
  onDecide: (
    groupId: string,
    decision: 'approve' | 'reject',
    activityIds?: readonly string[],
  ) => void;
  /** Save an inline edit of one proposal's input. */
  onEdit: (activityId: string, input: Record<string, unknown>) => void;
}

/**
 * The batch-review card for one proposal group.
 */
export function ProposalGroupCard({
  group,
  canAct,
  pending,
  onDecide,
  onEdit,
}: ProposalGroupCardProps): JSX.Element {
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const count = group.items.length;
  const selection = group.items.filter((item) => checked.has(item.activityId));

  const toggle = (activityId: string): void => {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(activityId)) next.delete(activityId);
      else next.add(activityId);
      return next;
    });
  };

  return (
    <section
      aria-label={`Proposed batch of ${String(count)} changes`}
      className="border-primary/40 bg-primary/5 rounded-xl border p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-on-surface text-body font-medium">
          Athena proposes {count} {count === 1 ? 'change' : 'changes'}
        </h3>
        <span className="text-on-surface-variant text-xs">
          Nothing is applied until you approve
        </span>
      </div>

      <ul className="mt-3 flex flex-col gap-1.5">
        {group.items.map((item) => (
          <ProposalRow
            key={item.activityId}
            item={item}
            canAct={canAct}
            pending={pending}
            checked={checked.has(item.activityId)}
            onToggle={toggle}
            onEdit={onEdit}
          />
        ))}
      </ul>

      {canAct ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={pending}
            onClick={() => {
              onDecide(group.proposalGroupId, 'approve');
            }}
          >
            {pending ? 'Working…' : `Approve all ${String(count)}`}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={pending || selection.length === 0}
            onClick={() => {
              onDecide(
                group.proposalGroupId,
                'approve',
                selection.map((item) => item.activityId),
              );
            }}
          >
            Approve selected{selection.length > 0 ? ` (${String(selection.length)})` : ''}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            className="text-destructive"
            onClick={() => {
              onDecide(group.proposalGroupId, 'reject');
            }}
          >
            Reject all
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/** Props for {@link ProposalRow}. */
interface ProposalRowProps {
  item: ProposalItemOut;
  canAct: boolean;
  pending: boolean;
  checked: boolean;
  onToggle: (activityId: string) => void;
  onEdit: (activityId: string, input: Record<string, unknown>) => void;
}

/** One ghost row of the batch: translucent, checkbox-selectable, title-editable. */
function ProposalRow({
  item,
  canAct,
  pending,
  checked,
  onToggle,
  onEdit,
}: ProposalRowProps): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.ghost?.title ?? '');
  const ghost = item.ghost;

  const commitEdit = (): void => {
    const trimmed = title.trim();
    setEditing(false);
    if (!ghost || trimmed.length === 0 || trimmed === ghost.title) {
      setTitle(ghost?.title ?? '');
      return;
    }
    onEdit(item.activityId, { ...item.input, title: trimmed });
  };

  return (
    <li
      style={{ viewTransitionName: `proposal-${item.activityId}` }}
      className={cn(
        // The ghost grammar: a real-row silhouette at reduced opacity with a dashed
        // accent — unmistakably "not real yet", solidified in place on approval.
        'border-primary/30 flex items-center gap-2.5 rounded-lg border border-dashed px-3 py-2',
        'bg-surface/60 opacity-80',
      )}
    >
      {canAct ? (
        <input
          type="checkbox"
          aria-label={`Select "${ghost?.title ?? item.summary}"`}
          checked={checked}
          disabled={pending}
          onChange={() => {
            onToggle(item.activityId);
          }}
          className="accent-primary h-4 w-4 shrink-0"
        />
      ) : null}

      <div className="flex min-w-0 flex-1 items-center gap-2">
        {ghost && editing ? (
          <input
            aria-label="Edit the proposed title"
            value={title}
            autoFocus
            disabled={pending}
            onChange={(event) => {
              setTitle(event.target.value);
            }}
            onBlur={commitEdit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitEdit();
              if (event.key === 'Escape') {
                setTitle(ghost.title);
                setEditing(false);
              }
            }}
            className="border-outline-variant bg-surface text-body focus-visible:ring-ring w-full rounded border px-2 py-0.5 outline-none focus-visible:ring-1"
          />
        ) : (
          <button
            type="button"
            disabled={!canAct || !ghost || pending}
            onClick={() => {
              setEditing(true);
            }}
            className={cn(
              'text-on-surface text-body min-w-0 truncate text-left',
              canAct && ghost ? 'hover:underline' : 'cursor-default',
            )}
            title={canAct && ghost ? 'Click to edit before approving' : undefined}
          >
            {ghost?.title ?? item.summary}
          </button>
        )}
        <span className="border-primary/40 text-primary shrink-0 rounded-full border px-1.5 py-px text-[10px] font-medium tracking-wide uppercase">
          proposed
        </span>
      </div>

      {ghost?.dueDate ? (
        <span className="text-on-surface-variant shrink-0 text-xs">{ghost.dueDate}</span>
      ) : null}
      <code className="text-on-surface-variant/70 shrink-0 text-[10px]">{item.tool}</code>
    </li>
  );
}
