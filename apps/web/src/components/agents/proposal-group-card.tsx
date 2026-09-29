'use client';

/**
 * One pending proposal group — the batch-review card (mvp-plan §8.6; the ghost system's
 * session-side surface).
 *
 * @remarks
 * A group is everything the agent proposed in ONE turn ("create these 3 tasks"), so it
 * reviews as a unit: a checkbox per member when there is more than one, inline title editing for
 * ghosts (the edit PATCHes the stored tool input — approval executes exactly what is shown), and
 * one decision row. Each ghost row carries a stable `view-transition-name`
 * keyed by its activity id, so when approval materializes the real task the browser can morph
 * ghost → row instead of swapping views.
 *
 * Every row reads as a plain sentence from {@link describeProposal} — never the raw tool
 * identifier a `ProposalItemOut` carries in `.tool`.
 */
import type { ProposalGroupOut, ProposalItemOut } from '@docket/athena/agent-contract';
import { cn } from '@docket/ui/lib/utils';
import { Button, Checkbox, Skeleton, Surface, surfaceToneColor } from '@docket/ui/primitives';
import { type JSX, useMemo, useState } from 'react';
import Link from 'next/link';

import { ProposalInputRows } from '@/components/athena/proposal-input-rows';
import { taskIdsFromInput, useHighlightHandlers } from '@/components/athena/proposal-highlight';
import { describeProposal, isOutwardProposal } from '@/lib/athena/describe-proposal';

/** Props for {@link ProposalGroupCard}. */
export interface ProposalGroupCardProps {
  /** Checked task context for a single change to an existing task. */
  target?:
    | {
        readonly title: string | null;
        readonly href: string;
        readonly loading: boolean;
        readonly unavailable: 'missing' | 'temporary' | null;
        readonly retry: () => void;
      }
    | undefined;
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

/** Batch size needs a heading only when selection changes what approval means. */
function headline(count: number): string {
  return `${String(count)} changes proposed`;
}

/**
 * The apply button's label.
 *
 * @remarks
 * A partial selection (some but not all rows checked) always reads as approving that selection;
 * anything else — nothing checked, or everything checked — reads as approving the whole group.
 */
function approveLabel(count: number, selectedCount: number): string {
  if (selectedCount > 0 && selectedCount < count) {
    return `Apply selected (${String(selectedCount)})`;
  }
  return count === 1 ? 'Apply change' : `Apply ${String(count)} changes`;
}

/**
 * The batch-review card for one proposal group.
 */
export function ProposalGroupCard({
  target,
  group,
  canAct,
  pending,
  onDecide,
  onEdit,
}: ProposalGroupCardProps): JSX.Element {
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [reviewed, setReviewed] = useState(false);
  const count = group.items.length;
  const selection = group.items.filter((item) => checked.has(item.activityId));
  const partialSelection = selection.length > 0 && selection.length < count;
  // A partial selection is reviewed on its own terms: approving only the in-Docket rows of a
  // mixed group needs no Review click, because nothing selected reaches outside Docket.
  const hasOutward = (partialSelection ? selection : group.items).some(isOutwardProposal);
  const needsReview = hasOutward && !reviewed;

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
      shape="medium"
      pad="comfortable"
      aria-label={`Proposed changes: ${String(count)}`}
      className="flex w-full flex-col gap-3"
    >
      {count > 1 ? <h3 className="text-on-surface text-label-large">{headline(count)}</h3> : null}
      {target?.unavailable && group.items[0] ? (
        <p className="text-on-surface text-label-large">{describeProposal(group.items[0])}</p>
      ) : null}
      {target ? <ProposalTargetStatus target={target} /> : null}

      {target?.unavailable ? null : (
        <ul className="flex flex-col gap-1.5">
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
      )}

      {canAct ? (
        <ProposalDecisionActions
          group={group}
          target={target}
          pending={pending}
          selection={selection}
          needsReview={needsReview}
          onReview={() => {
            setReviewed(true);
          }}
          onDecide={onDecide}
        />
      ) : null}
    </Surface>
  );
}

/** Keep the decision grammar in one place, including stale suggestions that can only be dismissed. */
function ProposalDecisionActions({
  group,
  target,
  pending,
  selection,
  needsReview,
  onReview,
  onDecide,
}: {
  readonly group: ProposalGroupOut;
  readonly target: ProposalGroupCardProps['target'];
  readonly pending: boolean;
  readonly selection: readonly ProposalItemOut[];
  readonly needsReview: boolean;
  readonly onReview: () => void;
  readonly onDecide: ProposalGroupCardProps['onDecide'];
}): JSX.Element {
  const count = group.items.length;
  const decide = (): void => {
    if (needsReview) {
      onReview();
      return;
    }
    if (selection.length > 0 && selection.length < count) {
      onDecide(
        group.proposalGroupId,
        'approve',
        selection.map((item) => item.activityId),
      );
      return;
    }
    onDecide(group.proposalGroupId, 'approve');
  };
  return (
    <div className="flex items-center gap-2">
      {target?.unavailable === 'temporary' ? (
        <Button type="button" variant="secondary" size="sm" onClick={target.retry}>
          Try again
        </Button>
      ) : null}
      {target?.unavailable ? null : (
        <Button size="sm" disabled={pending || target?.loading === true} onClick={decide}>
          {needsReview ? 'Review' : approveLabel(count, selection.length)}
        </Button>
      )}
      <Button
        variant={target?.unavailable ? 'ghost' : 'ghost-destructive'}
        size="sm"
        disabled={pending}
        onClick={() => {
          onDecide(group.proposalGroupId, 'reject');
        }}
      >
        {target?.unavailable ? 'Dismiss' : 'Reject'}
      </Button>
    </div>
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
  /** Mirrors the row's pointer-hover highlight for keyboard focus of this control. */
  onFocusRow: () => void;
  onBlurRow: () => void;
}

/** The row's title: a static sentence, or — for a ghost — an inline-editable one. */
function ProposalRowTitle({
  item,
  canAct,
  pending,
  sentence,
  onEdit,
  onFocusRow,
  onBlurRow,
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
        onFocus={onFocusRow}
        onBlur={() => {
          commitEdit();
          onBlurRow();
        }}
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
      onFocus={onFocusRow}
      onBlur={onBlurRow}
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
  const outward = isOutwardProposal(item);
  const targetIds = useMemo(() => taskIdsFromInput(item.input), [item.input]);
  const highlight = useHighlightHandlers(targetIds);

  return (
    <li
      style={{ viewTransitionName: `proposal-${item.activityId}` }}
      className="flex flex-col gap-1.5"
      onPointerEnter={highlight.onPointerEnter}
      onPointerLeave={highlight.onPointerLeave}
    >
      <div className="flex items-center gap-2.5">
        {showCheckbox && canAct ? (
          <Checkbox
            aria-label={`Select "${sentence}"`}
            checked={checked}
            disabled={pending}
            onChange={() => {
              onToggle(item.activityId);
            }}
            onFocus={highlight.onFocus}
            onBlur={highlight.onBlur}
          />
        ) : null}
        <ProposalRowTitle
          item={item}
          canAct={canAct}
          pending={pending}
          sentence={sentence}
          onEdit={onEdit}
          onFocusRow={highlight.onFocus}
          onBlurRow={highlight.onBlur}
        />
      </div>

      {outward && reviewed ? (
        <ProposalInputRows input={item.input} className={surfaceToneColor('card')} />
      ) : null}
    </li>
  );
}

/** Show a task name when verified and a concrete outcome when the suggestion cannot apply. */
function ProposalTargetStatus({
  target,
}: {
  readonly target: NonNullable<ProposalGroupCardProps['target']>;
}): JSX.Element {
  if (target.loading) return <Skeleton className="h-4 w-2/5" aria-hidden="true" />;
  if (target.unavailable) {
    return (
      <p className="text-on-surface text-body-small">
        {target.unavailable === 'missing'
          ? 'The task is no longer available. This suggestion can’t be applied.'
          : 'The task is unavailable right now. Try again to review this suggestion.'}
      </p>
    );
  }
  return (
    <Link
      href={target.href}
      className="text-on-surface text-label-large w-fit max-w-full truncate hover:underline"
    >
      {target.title ?? 'Task'}
    </Link>
  );
}
