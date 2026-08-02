'use client';

/**
 * `components/selection/selection-checkbox` — the point-and-click half of multi-select.
 *
 * @remarks
 * Modifier-click is fast and invisible; a checkbox is slow and obvious. A list needs both, because
 * the person who knows ⌘-click is not the person who will find it, and neither should have to
 * learn the other's way to select two things.
 *
 * Two details carry most of the craft:
 *
 * - **The slot never collapses.** The checkbox is always laid out and always the same size; only
 *   its opacity changes. Revealing it by adding it to the DOM on hover would reflow the row's
 *   contents sideways under the pointer, and an element that changes size on interaction is
 *   exactly what the app forbids.
 * - **It stays visible once anything is selected.** Hiding the ticks of selected rows the moment
 *   the pointer leaves would make a selection you cannot see, so the whole column latches on while
 *   the list has a selection.
 *
 * **Requirement on the row.** Hover reveal is scoped to the row via Tailwind's named group, so the
 * row root must carry `group/row`. Without it the checkbox is simply always hidden until something
 * is selected — no layout breakage, but the hover affordance is lost, so the class belongs in every
 * row preset rather than being remembered per surface.
 */
import { cn } from '@docket/ui';
import { Checkbox } from '@docket/ui/primitives';
import type { ChangeEvent, JSX, MouseEvent as ReactMouseEvent } from 'react';

import { CURSOR_CLICKABLE } from '@/lib/actions/cursor';
import type { ObjectRef } from '@/lib/actions/object';

import { useSelectableRow, useSelection } from './selection-context';

/** Props for {@link SelectionCheckbox}. */
export interface SelectionCheckboxProps {
  /** The object whose row this checkbox selects. */
  readonly object: ObjectRef;
  /** Extra classes for the wrapper. */
  readonly className?: string;
}

/**
 * The per-row selection checkbox.
 *
 * @remarks
 * Must be rendered inside a `SelectionProvider`; it reads its state from the row binding rather
 * than taking `checked`/`onChange` props, so a row cannot accidentally wire it to something other
 * than the selection it appears to control.
 *
 * @param props - The row's object.
 * @returns The checkbox element.
 */
export function SelectionCheckbox({ object, className }: SelectionCheckboxProps): JSX.Element {
  const { count } = useSelection();
  const { selected, toggle } = useSelectableRow(object);
  const latched = selected || count > 0;

  return (
    <span
      className={cn(
        'inline-flex size-4 shrink-0 items-center justify-center transition-opacity duration-(--dur-base)',
        latched ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100 focus-within:opacity-100',
        className,
      )}
    >
      <Checkbox
        checked={selected}
        aria-label={`Select ${object.title}`}
        className={CURSOR_CLICKABLE}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          // The checkbox owns exactly one row: it toggles, never replaces or extends, whatever
          // modifiers happen to be held.
          event.stopPropagation();
          toggle();
        }}
        onClick={(event: ReactMouseEvent<HTMLInputElement>) => {
          // Without this the row's own click handler would also run and replace the selection
          // with this single row — the tick would appear to do the opposite of what it says.
          event.stopPropagation();
        }}
      />
    </span>
  );
}

/**
 * The header checkbox that selects or clears every row at once.
 *
 * @remarks
 * Shows the mixed state when some but not all rows are selected, which is the only honest way to
 * render a partial selection: an unchecked box would imply clicking it selects nothing new, and a
 * checked one would imply everything is already selected.
 *
 * @param props - Optional extra classes.
 * @returns The header checkbox element.
 */
export function SelectAllCheckbox({ className }: { readonly className?: string }): JSX.Element {
  const { items, count, selectAll, clear } = useSelection();
  const all = items.length > 0 && count === items.length;
  const some = count > 0 && !all;

  return (
    <span className={cn('inline-flex size-4 shrink-0 items-center justify-center', className)}>
      <Checkbox
        checked={all}
        indeterminate={some}
        disabled={items.length === 0}
        aria-label={all ? 'Clear selection' : 'Select all rows'}
        className={CURSOR_CLICKABLE}
        onChange={() => {
          if (all) clear();
          else selectAll();
        }}
      />
    </span>
  );
}
