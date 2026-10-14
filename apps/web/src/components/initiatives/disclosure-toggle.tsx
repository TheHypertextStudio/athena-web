'use client';

/**
 * The chevron that opens and closes one container in the connected-work tree.
 *
 * @remarks
 * A container needs an affordance that is not its own title: the title is a link to the object, and
 * a click has to keep meaning "open this Project" rather than becoming a gamble about where in the
 * row the pointer landed. So the toggle is its own control, sits outside the object row, and says
 * in its accessible name what it will do.
 *
 * It is always visible rather than revealed on hover. A disclosure a reader cannot see is a
 * disclosure they do not know they have, and on a touch screen there is no hover to reveal it.
 */
import { ChevronRight } from '@docket/ui/icons';
import { Button, CollapsibleTrigger } from '@docket/ui/primitives';
import { cn } from '@docket/ui/lib/utils';
import type { JSX } from 'react';

/** Props for {@link DisclosureToggle}. */
export interface DisclosureToggleProps {
  /** Whether the container is open, which sets the chevron's rotation. */
  readonly open: boolean;
  /** What the toggle reveals, for its accessible name — e.g. `"Service quality"`. */
  readonly label: string;
}

/** The container's open/close control. */
export function DisclosureToggle({ open, label }: DisclosureToggleProps): JSX.Element {
  return (
    <CollapsibleTrigger asChild>
      <Button
        variant="ghost"
        controlSize="sm"
        iconOnly
        className="text-on-surface-variant shrink-0"
        aria-label={`${open ? 'Collapse' : 'Expand'} ${label}`}
      >
        <ChevronRight
          aria-hidden
          className={cn('size-4 transition-transform', open ? 'rotate-90' : '')}
        />
      </Button>
    </CollapsibleTrigger>
  );
}
