import { X } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import type { JSX } from 'react';

/** Visible, touch-sized close action shared by every calendar drawer state. */
export function CalendarDrawerClose({
  label,
  onClick,
}: {
  readonly label: string;
  readonly onClick: () => void;
}): JSX.Element {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="-mt-2 -mr-2 size-10 shrink-0 self-end"
      aria-label={label}
      onClick={onClick}
    >
      <X aria-hidden="true" className="size-4" />
    </Button>
  );
}
