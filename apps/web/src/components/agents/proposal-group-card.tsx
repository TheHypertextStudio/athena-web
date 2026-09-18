'use client';

/**
 * One pending proposal group — the batch-review card (mvp-plan §8.6; the ghost system's
 * session-side surface).
 *
 * @remarks
 * A group is everything the agent proposed in ONE turn ("create these 3 tasks"), so it
 * reviews as a unit: a checkbox per member when there is more than one, inline title editing for
 * ghosts (the edit PATCHes the stored tool input — approval executes exactly what is shown), and
 * one `Approve` / `Reject` action pair. Each ghost row carries a stable `view-transition-name`
 * keyed by its activity id, so when approval materializes the real task the browser can morph
 * ghost → row instead of swapping views.
 *
 * Every row reads as a plain sentence from {@link describeProposal} — never the raw tool
 * identifier a `ProposalItemOut` carries in `.tool`.
 */
import type { ProposalGroupOut, ProposalItemOut } from '@docket/athena/agent-contract';
import { cn } from '@docket/ui/lib/utils';
import { Button, Surface, surfaceToneColor } from '@docket/ui/primitives';
import { type JSX, useState } from 'react';

import { ProposalInputRows } from '@/components/athena/proposal-input-rows';
import { describeProposal, isOutwardTool } from '@/lib/athena/describe-proposal';

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

/** The header line: "1 change proposed" or "N changes proposed". */
function headline(count: number): string {
  return count === 1 ? '1 change proposed' : `${String(count)} changes proposed`;
}

/**
 * The `Approve` button's label.
 *
 * @remarks
 * A partial selection (some but not all rows checked) always reads as approving that selection;
 * anything else — nothing checked, or everything checked — reads as approving the whole group.
 */
function approveLabel(count: number, selectedCount: number): string {
  if (selectedCount > 0 && selectedCount < count) {
    return `Approve selected (${String(selectedCount)})`;
  }
  return count === 1 ? 'Approve' : `Approve ${String(count)}`;
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
  const [reviewed, setReviewed] = useState(false);
  const count = group.items.length;
  const hasOutward = group.items.some((item) => isOutwardTool(item.tool));
  const needsReview = hasOutward && !reviewed;
  const selection = group.items.filter((item) => checked.has(item.activityId));
  const partialSelection = selection.length > 0 && selection.length < count;

  const toggle = (activityId: string): void => {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(activityId)) next.delete(activityId);
      else next.add(activityId);
      return next;
    });
  };

  return (
    <Surface
      as="section"
      tone="card"
      shape="small"
      pad="roomy"
      aria-label={`Proposed changes: ${String(count)}`}
      className="bg-primary/5 rounded-xl"
    >
      <h3 className="text-on-surface text-label-large">{headline(count)}</h3>

      <ul className="mt-3 flex flex-col gap-1.5">
        {group.items.map((item) => (
          <ProposalRow
            key={item.activityId}
            item={item}
            canAct={canAct}
            pending={pending}
            showCheckbox={count > 1}
            checked={checked.has(item.activityId)}
            reviewed={reviewed}
            onToggle={toggle}
            onEdit={onEdit}
          />
        ))}
      </ul>

      {canAct ? (
        <div className="mt-4 flex items-center gap-2">
          <Button
            size="sm"
            disabled={pending}
            onClick={() => {
              if (needsReview) {
                setReviewed(true);
                return;
              }
              if (partialSelection) {
                onDecide(
                  group.proposalGroupId,
                  'approve',
                  selection.map((item) => item.activityId),
                );
                return;
              }
              onDecide(group.proposalGroupId, 'approve');
            }}
          >
            {needsReview ? 'Review' : approveLabel(count, selection.length)}
          </Button>
          <Button
            variant="ghost-destructive"
            size="sm"
            disabled={pending}
            onClick={() => {
              onDecide(group.proposalGroupId, 'reject');
            }}
          >
            Reject
          </Button>
        </div>
      ) : null}
    </Surface>
  );
}

/** Props for {@link ProposalRow}. */
interface ProposalRowProps {
  item: ProposalItemOut;
  canAct: boolean;
  pending: boolean;
  /** Whether to render the selection checkbox — only when the group has more than one item. */
  showCheckbox: boolean;
  checked: boolean;
  /** Whether the group's outward items have been expanded for review before approving. */
  reviewed: boolean;
  onToggle: (activityId: string) => void;
  onEdit: (activityId: string, input: Record<string, unknown>) => void;
}

/** Props for {@link ProposalRowTitle}. */
interface ProposalRowTitleProps {
  item: ProposalItemOut;
  canAct: boolean;
  pending: boolean;
  sentence: string;
  onEdit: (activityId: string, input: Record<string, unknown>) => void;
}

/** The row's title: a static sentence, or — for a ghost — an inline-editable one. */
function ProposalRowTitle({
  item,
  canAct,
  pending,
  sentence,
  onEdit,
}: ProposalRowTitleProps): JSX.Element {
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

  if (ghost && editing) {
    return (
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
        className={cn(
          surfaceToneColor('prominent'),
          'text-body-medium focus-visible:ring-ring w-full min-w-0 flex-1 rounded px-2 py-0.5 outline-none focus-visible:ring-1',
        )}
      />
    );
  }
  return (
    <button
      type="button"
      disabled={!canAct || !ghost || pending}
      onClick={() => {
        setEditing(true);
      }}
      className={cn(
        'text-on-surface text-body-medium line-clamp-2 min-w-0 flex-1 text-left',
        canAct && ghost ? 'hover:underline' : 'cursor-default',
      )}
      title={canAct && ghost ? 'Click to edit before approving' : undefined}
    >
      {sentence}
    </button>
  );
}

/** One ghost row of the batch: translucent, optionally selectable, title-editable. */
function ProposalRow({
  item,
  canAct,
  pending,
  showCheckbox,
  checked,
  reviewed,
  onToggle,
  onEdit,
}: ProposalRowProps): JSX.Element {
  const sentence = describeProposal(item);
  const outward = isOutwardTool(item.tool);

  return (
    <li
      style={{ viewTransitionName: `proposal-${item.activityId}` }}
      className={cn(
        // The ghost grammar: a tonal tint at reduced opacity, not a drawn outline —
        // unmistakably "not real yet", solidified in place on approval.
        'bg-primary-container/25 flex flex-col gap-1.5 rounded-lg px-3 py-2 opacity-80',
      )}
    >
      <div className="flex items-center gap-2.5">
        {showCheckbox && canAct ? (
          <input
            type="checkbox"
            aria-label={`Select "${sentence}"`}
            checked={checked}
            disabled={pending}
            onChange={() => {
              onToggle(item.activityId);
            }}
            className="accent-primary h-4 w-4 shrink-0"
          />
        ) : null}
        <ProposalRowTitle
          item={item}
          canAct={canAct}
          pending={pending}
          sentence={sentence}
          onEdit={onEdit}
        />
      </div>

      {outward && reviewed ? (
        <ProposalInputRows input={item.input} className={surfaceToneColor('card')} />
      ) : null}
    </li>
  );
}
