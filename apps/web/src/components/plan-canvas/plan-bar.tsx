'use client';

/**
 * `components/plan-canvas/plan-bar` — the one floating bar over a plan.
 *
 * @remarks
 * The way back, the plan's title, a search that rests as a button, Add project, and the counts
 * share a single row over the top-left of the board. When something is selected the counts give
 * way to the selection's actions in that same row, so nothing floats over the board and covers a
 * node. The conversation opens from the rail's Athena icon, which the route claims.
 */
import { CheckCircle2, OpenInNew, Plus, Sparkles, Trash2 } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { Button } from '@docket/ui/primitives';
import type { PlanDraftOut } from '@docket/work/plan-draft-contract';
import { type JSX, type ReactNode, useMemo } from 'react';

import CanvasFloatingBar from '@/components/canvas/canvas-floating-bar';
import CanvasSearchField from '@/components/canvas/canvas-search-field';

import { describeConfirmation } from './plan-confirm';

/** What the selection's actions need. */
export interface PlanSelectionActionsProps {
  readonly plan: PlanDraftOut;
  /** The selected refs, from the canvas. */
  readonly refs: readonly string[];
  readonly canEdit: boolean;
  /** Whether a commit is in flight, so Confirm cannot be pressed twice. */
  readonly committing: boolean;
  /** Confirm these refs (the closure is computed by the caller). */
  readonly onConfirm: (refs: readonly string[]) => void;
  /** Remove these draft refs. */
  readonly onRemove: (refs: readonly string[]) => void;
  /** Open the conversation about these refs. */
  readonly onAsk: (refs: readonly string[]) => void;
  /** Open a confirmed node's real record. */
  readonly onOpen: (href: string) => void;
}

/** The actions for the current selection: count, Confirm, Open, Ask Athena, Remove. */
export function PlanSelectionActions({
  plan,
  refs,
  canEdit,
  committing,
  onConfirm,
  onRemove,
  onAsk,
  onOpen,
}: PlanSelectionActionsProps): JSX.Element {
  const confirmation = useMemo(() => describeConfirmation(plan.document, refs), [plan, refs]);
  const nodes = refs.map((ref) => plan.document.nodes.find((node) => node.ref === ref));
  const drafts = nodes.filter((node) => node?.status === 'draft');
  const single = refs.length === 1 ? nodes[0] : undefined;
  const href = single ? (plan.objects[single.ref]?.href ?? null) : null;
  return (
    <>
      <span className="text-on-surface text-label-large shrink-0 px-2 whitespace-nowrap">
        {refs.length} selected
      </span>
      {canEdit && confirmation.count > 0 ? (
        <Button
          type="button"
          size="sm"
          disabled={committing}
          title={confirmation.label}
          onClick={() => {
            onConfirm(refs);
          }}
        >
          <CheckCircle2 className="size-4" /> Confirm
        </Button>
      ) : null}
      {href !== null ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          iconOnly
          aria-label="Open"
          title="Open"
          onClick={() => {
            onOpen(href);
          }}
        >
          <OpenInNew className="size-4" />
        </Button>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        aria-label="Ask Athena"
        title="Ask Athena"
        onClick={() => {
          onAsk(refs);
        }}
      >
        <Sparkles className="size-4" /> <span className="hidden @3xl:inline">Ask Athena</span>
      </Button>
      {canEdit && drafts.length > 0 ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          iconOnly
          aria-label="Remove"
          title="Remove"
          className="text-error"
          onClick={() => {
            onRemove(drafts.map((node) => node?.ref ?? '').filter((ref) => ref.length > 0));
          }}
        >
          <Trash2 className="size-4" />
        </Button>
      ) : null}
    </>
  );
}

/** The plan's counts, shown while nothing is selected. */
export interface PlanCounts {
  readonly projects: number;
  readonly tasks: number;
  readonly draft: number;
}

/** Props for {@link PlanBar}. */
export interface PlanBarProps {
  readonly title: string;
  /** The way back: an icon button before the title. */
  readonly navigation: ReactNode;
  readonly search: string;
  readonly onSearchChange: (value: string) => void;
  readonly counts: PlanCounts;
  /** Add a project by hand; null when the viewer cannot edit. */
  readonly onAddProject: (() => void) | null;
  /** The selection's actions; the bar shows them in place of the counts while refs are selected. */
  readonly selection: PlanSelectionActionsProps;
  /** Pixels spoken for on the right by floating columns. */
  readonly insetRight: number;
  readonly onHeightChange: (height: number) => void;
}

/** The floating bar over a plan. */
export default function PlanBar({
  title,
  navigation,
  search,
  onSearchChange,
  counts,
  onAddProject,
  selection,
  insetRight,
  onHeightChange,
}: PlanBarProps): JSX.Element {
  return (
    <CanvasFloatingBar
      title={title}
      ariaLabel="Plan"
      navigation={navigation}
      insetRight={insetRight}
      onHeightChange={onHeightChange}
      controls={
        <>
          <CanvasSearchField value={search} onChange={onSearchChange} label="Search the plan" />
          {onAddProject ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="Add project"
              onClick={onAddProject}
            >
              <Plus className="size-4" />
              <span className="hidden @2xl:inline">Project</span>
            </Button>
          ) : null}
        </>
      }
      trailing={
        <span
          className={cn(
            'text-label-medium hidden shrink-0 px-2 whitespace-nowrap @md:inline',
            counts.draft > 0 ? 'text-primary' : 'text-on-surface-variant',
          )}
          data-testid="plan-counts"
        >
          {counts.draft} {counts.draft === 1 ? 'draft' : 'drafts'}
        </span>
      }
      selection={selection.refs.length > 0 ? <PlanSelectionActions {...selection} /> : null}
    />
  );
}
