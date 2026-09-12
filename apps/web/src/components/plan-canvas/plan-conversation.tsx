'use client';

/**
 * `components/plan-canvas/plan-conversation` — the conversation, floating beside the board.
 *
 * @remarks
 * A plan is shaped by talking, so the conversation lives on the canvas rather than in the shell's
 * rail: a floating column over the right edge, on the org's chat thread, which is the session the
 * plan tools bind to. It reports its width so the board keeps its frame out from under it, and
 * hands focus back to the bar's Athena toggle when it closes.
 */
import { OpenInNew, Sparkles, X } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import type { JSX } from 'react';

import AthenaConversation from '@/components/athena/athena-conversation';
import CanvasFloatingColumn from '@/components/canvas/canvas-floating-column';
import Link from '@/components/docket-link';

/** Props for {@link PlanConversation}. */
export interface PlanConversationProps {
  readonly orgId: string;
  /** A draft handed to the composer after mount; see `AthenaConversation`. */
  readonly draftRequest: { readonly text: string; readonly version: number } | null;
  /** Where the full Athena workspace lives, for the "Open full" link. */
  readonly fullHref: string;
  /** Pixels another floating column already takes at the right edge. */
  readonly offsetRight: number;
  readonly onClose: () => void;
  readonly onWidthChange: (width: number) => void;
}

/** The floating conversation column over a plan. */
export default function PlanConversation({
  orgId,
  draftRequest,
  fullHref,
  offsetRight,
  onClose,
  onWidthChange,
}: PlanConversationProps): JSX.Element {
  const close = (): void => {
    onClose();
    document.querySelector<HTMLButtonElement>('[data-plan-athena-toggle="true"]')?.focus();
  };
  return (
    <CanvasFloatingColumn
      label="Athena"
      offsetRight={offsetRight}
      onEscape={close}
      onWidthChange={onWidthChange}
      className="w-[clamp(17.5rem,17vw,22rem)]"
    >
      <div className="border-outline-variant flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <Sparkles aria-hidden="true" className="text-primary size-4" />
        <span className="text-on-surface text-label-large min-w-0 flex-1 truncate">Athena</span>
        <Button variant="ghost" size="sm" asChild>
          <Link href={fullHref}>
            <OpenInNew aria-hidden="true" className="size-4" /> Open full
          </Link>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          iconOnly
          aria-label="Close Athena"
          onClick={close}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <AthenaConversation
        orgId={orgId}
        className="min-h-0 flex-1 px-3 pb-3"
        draftRequest={draftRequest}
      />
    </CanvasFloatingColumn>
  );
}
