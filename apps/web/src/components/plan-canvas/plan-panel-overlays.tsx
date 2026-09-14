'use client';

/**
 * `components/plan-canvas/plan-panel-overlays` — what floats over the board besides the chrome.
 *
 * @remarks
 * The start states (an empty plan, a rooted plan with nothing under it), the "Athena updated"
 * pill, and the undoable notice. The pill and the notice share the slot above the view controls,
 * a notice winning when both are due, so no transient surface ever collides with the bar.
 */
import { EmptyState } from '@docket/ui/components';
import { Plus, Sparkles, Undo } from '@docket/ui/icons';
import { Button, Surface } from '@docket/ui/primitives';
import type { JSX } from 'react';

import CanvasOverlayPanel from '@/components/canvas/canvas-overlay-panel';

import type { PlanNotice, PlanStartState } from './plan-panel-support';

/** What a rooted plan shows while nothing is planned under its initiative yet. */
function PlanStartHint({
  onAddProject,
}: {
  readonly onAddProject: (() => void) | null;
}): JSX.Element {
  return (
    <Surface
      tone="floating"
      shape="medium"
      className="text-on-surface-variant text-body-small pointer-events-auto flex max-w-[calc(100vw-1rem)] items-center gap-3 px-3 py-2"
      data-testid="plan-start-hint"
    >
      <Sparkles aria-hidden="true" className="text-primary size-4 shrink-0" />
      <span className="min-w-0">
        Tell Athena what this initiative involves and she will draft the projects here.
      </span>
      {onAddProject ? (
        <Button type="button" size="sm" variant="secondary" onClick={onAddProject}>
          <Plus className="size-4" /> Add project
        </Button>
      ) : null}
    </Surface>
  );
}

/** Props for {@link PlanStartOverlay}. */
export interface PlanStartOverlayProps {
  readonly state: PlanStartState;
  readonly onAddProject: (() => void) | null;
}

/**
 * What the canvas shows before there is a board to read: an empty state when nothing is drafted,
 * a hint beside the lone initiative card once a plan is rooted but nothing sits under it.
 */
export function PlanStartOverlay({
  state,
  onAddProject,
}: PlanStartOverlayProps): JSX.Element | null {
  if (state === 'underway') return null;
  if (state === 'initiative-only') {
    return (
      <CanvasOverlayPanel position="top-center" className="!top-16">
        <PlanStartHint onAddProject={onAddProject} />
      </CanvasOverlayPanel>
    );
  }
  return (
    <CanvasOverlayPanel position="top-center" className="!top-1/2 !-translate-y-1/2">
      <EmptyState
        icon={Sparkles}
        title="Nothing on the canvas yet"
        body="Tell Athena what you are planning, or add a project to start by hand."
        {...(onAddProject
          ? {
              action: (
                <Button type="button" onClick={onAddProject}>
                  <Plus className="size-4" /> Add project
                </Button>
              ),
            }
          : {})}
      />
    </CanvasOverlayPanel>
  );
}

/** The "Athena updated" pill: a transient status above the view controls. */
function PlanUpdatePill({ text }: { readonly text: string }): JSX.Element {
  return (
    <Surface
      tone="floating"
      shape="medium"
      role="status"
      className="text-primary text-label-medium pointer-events-auto flex items-center gap-1.5 px-2.5 py-1"
      data-testid="plan-update-pill"
    >
      <Sparkles aria-hidden="true" className="size-3.5" />
      {text}
    </Surface>
  );
}

/** A transient notice above the view controls, with Undo when the change can be taken back. */
function PlanNoticeSurface({
  notice,
  onDismiss,
}: {
  readonly notice: PlanNotice;
  readonly onDismiss: () => void;
}): JSX.Element {
  return (
    <Surface
      tone="prominent"
      shape="small"
      role={notice.tone === 'error' ? 'alert' : 'status'}
      className="pointer-events-auto flex w-full max-w-[min(32rem,calc(100vw-2rem))] min-w-0 flex-col items-stretch gap-2 px-3 py-2 sm:w-auto sm:flex-row sm:items-center"
    >
      <div className="min-w-0 flex-1">
        <p className="text-label-large text-on-surface">{notice.title}</p>
        <p className="text-body-small text-on-surface-variant break-words sm:truncate">
          {notice.detail}
        </p>
      </div>
      <div className="flex shrink-0 justify-end gap-1">
        {notice.undo ? (
          <Button type="button" variant="ghost" size="sm" onClick={notice.undo}>
            <Undo className="size-4" /> Undo
          </Button>
        ) : null}
        <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </Surface>
  );
}

/**
 * What sits above the view controls: an undoable notice wins over the update pill, so the two
 * transient surfaces never stack and neither ever collides with the bar up top.
 */
export function bottomSlot(
  notice: PlanNotice | null,
  pill: string | null,
  onDismiss: () => void,
): JSX.Element | undefined {
  if (notice !== null) return <PlanNoticeSurface notice={notice} onDismiss={onDismiss} />;
  if (pill !== null) return <PlanUpdatePill text={pill} />;
  return undefined;
}
