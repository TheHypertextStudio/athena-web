'use client';

/**
 * `@docket/ui` — the grip on a reorderable row.
 *
 * @remarks
 * ## Quiet, and always there
 *
 * A resting list should read as content, so the grip fades up on hover of its row
 * (`group-hover/row`), on keyboard focus, and while its row is held. It reaches that quiet through
 * `opacity`, never `display: none` or conditional rendering — a grip that only exists while the
 * pointer is over the row is a grip a keyboard user can never reach, because tabbing to it is what
 * would have to make it appear. Opacity keeps it in the DOM, in the accessibility tree, and in tab
 * order at all times, so Tab reaches it, focus reveals it, and the whole keyboard reorder path
 * stays open.
 *
 * The row root must carry `group/row` for the hover reveal to work; the same convention the
 * selection checkbox and {@link EntityListRow}'s trailing affordances already use.
 *
 * ## Size
 *
 * 24px with a fine pointer, where a cursor lands exactly where it is aimed and a larger target
 * would crowd the row's content. On a coarse pointer it grows to 40px — a finger has no such
 * precision, and 40px is the floor for a touch target. Touch also has no hover to reveal anything,
 * so the grip is simply always visible there.
 *
 * ## Behavior lives elsewhere
 *
 * This renders the affordance and nothing else. Grab, move, drop, and cancel come from
 * {@link useReorderable}, whose `handleProps(id)` spread onto this button supply `aria-label`,
 * `aria-pressed`, and the key and click handlers.
 */
import * as React from 'react';

import { GripVertical } from '../../icons';
import { cn } from '../../lib/utils';
import { focusRing } from '../../primitives/focus';

/**
 * Props for {@link DragHandle}.
 *
 * @remarks
 * Every native button attribute passes through, which is what lets a caller spread
 * `handleProps(id)` from {@link useReorderable} straight onto it. `type` is fixed to `button`
 * regardless of what is spread, so a grip inside a form never submits it.
 */
export type DragHandleProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

/** The grip's own classes; see the module remarks for why each group is here. */
const DRAG_HANDLE_CLASS = [
  'inline-flex size-6 shrink-0 cursor-grab items-center justify-center rounded-sm',
  'text-on-surface-variant hover:text-on-surface active:cursor-grabbing',
  'opacity-0 transition-opacity',
  'group-hover/row:opacity-100 focus-visible:opacity-100 aria-pressed:opacity-100',
  'pointer-coarse:size-10 pointer-coarse:opacity-100',
  'disabled:invisible disabled:cursor-default',
].join(' ');

/**
 * The two-column dot grip that picks a row up.
 *
 * @param props - Any button attributes, typically the `handleProps(id)` bag from
 * {@link useReorderable}, plus optional extra classes.
 * @returns The grip button.
 *
 * @example
 * ```tsx
 * <li className="group/row flex items-center gap-2" {...itemProps(status.id)}>
 *   <DragHandle {...handleProps(status.id)} />
 *   <StatusIcon type={status.category} />
 *   {status.name}
 * </li>
 * ```
 *
 * @see {@link useReorderable} for the grab / move / drop behavior this grip triggers.
 */
export function DragHandle({ className, ...props }: DragHandleProps): React.JSX.Element {
  return (
    // `type` sits after the spread so a caller can never turn the grip into a submit button.
    <button {...props} type="button" className={cn(DRAG_HANDLE_CLASS, focusRing, className)}>
      {/*
       * Sized with an important utility for the reason {@link StatusIcon} documents at length: MUI
       * injects its own icon sizing from `@layer mui`, and which layer wins is a load-order race
       * rather than something a class's source position settles.
       */}
      <GripVertical aria-hidden="true" className="size-4!" />
    </button>
  );
}
