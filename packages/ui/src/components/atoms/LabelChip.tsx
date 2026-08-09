'use client';

/**
 * `@docket/ui` — the label chip.
 *
 * @remarks
 * ## Two forms, because Badge is not Chip
 *
 * A label appears in two situations and they are genuinely different interactions, so this
 * renders as the matching primitive rather than one shape pretending to be both:
 *
 * - **`read`** (default) — a label on a list row. You look at it. Fully round, non-interactive,
 *   the {@link Badge} shape.
 * - **`action`** — a label you can press to filter by, or remove from an entity. 8px corners and
 *   a control height, the {@link Chip} shape.
 *
 * `rounded-full` responding to a click is the exact confusion the primitives doc calls out, so
 * `onActivate` and `onRemove` are only honored on `action`.
 *
 * ## Colour comes from a key, never a hex
 *
 * The chip emits `data-label-color` and the stylesheet resolves it to `--label-dot` /
 * `--label-container` / `--label-on-container` for the active theme. A stored hex — which is what
 * the old inline `style={{ background }}` used, and what a label mirrored from a provider still
 * carries — cannot work: one fixed value cannot read against both a L 0.98 and a L 0.23 surface.
 * An unrecognized key falls through to the `slate` neutral rather than rendering colourless.
 *
 * The treatment is a tinted container plus a saturated dot, never a saturated fill. Ten filled
 * hues cannot all hold readable text in both themes, and a wall of filled chips shouts louder
 * than the work they annotate. The dot doubles as the required leading mark, so a label chip is
 * never a bare text pill (`CRAFT-13`).
 */
import * as React from 'react';

import { cn } from '../../lib/utils';

/** The label palette keys the stylesheet knows how to resolve. */
const LABEL_COLOR_KEYS = [
  'blue',
  'indigo',
  'violet',
  'plum',
  'pink',
  'coral',
  'amber',
  'green',
  'teal',
  'slate',
] as const;

/** One of the label palette keys. */
export type LabelChipColor = (typeof LABEL_COLOR_KEYS)[number];

/**
 * Coerce a stored colour into a palette key.
 *
 * @remarks
 * Labels mirrored from a connected tool carry that provider's hex. Rather than fail or render an
 * uncoloured chip, an unknown value resolves to the neutral — the label is still legible and
 * still identifiable by name, and recolouring it in settings rewrites the stored value.
 *
 * @param color - The stored `label.color`.
 * @returns A key the stylesheet can resolve.
 */
export function labelColorKey(color: string | null | undefined): LabelChipColor {
  return color != null && (LABEL_COLOR_KEYS as readonly string[]).includes(color)
    ? (color as LabelChipColor)
    : 'slate';
}

/** Props for {@link LabelChip}. */
export interface LabelChipProps {
  /** The label's display text. */
  name: string;
  /** The label's stored colour; anything unrecognized renders as the neutral. */
  color?: string | null;
  /**
   * `read` renders the non-interactive Badge shape (list rows, detail summaries); `action`
   * renders the pressable Chip shape. Defaults to `read`.
   */
  variant?: 'read' | 'action';
  /** Press handler — `action` only. Typically "filter this list by this label". */
  onActivate?: () => void;
  /** Show a trailing remove affordance — `action` only. */
  onRemove?: () => void;
  /** Accessible name for the remove control, e.g. `Remove label design`. */
  removeLabel?: string;
  /** Extra classes for the outer element. */
  className?: string;
}

/** The saturated dot: the chip's leading mark and its only fully-saturated ink. */
function LabelDot(): React.JSX.Element {
  return <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-(--label-dot)" />;
}

/**
 * Render a label as a chip.
 *
 * @param props - The {@link LabelChipProps}.
 * @returns The rendered chip.
 */
export function LabelChip({
  name,
  color,
  variant = 'read',
  onActivate,
  onRemove,
  removeLabel,
  className,
}: LabelChipProps): React.JSX.Element {
  const shared =
    'inline-flex items-center gap-1.5 bg-(--label-container) text-(--label-on-container)';
  const colorAttr = labelColorKey(color);

  if (variant === 'read') {
    return (
      <span
        data-label-color={colorAttr}
        // `label-small` + `rounded-full`: the Badge recipe. A read-only label hugs its content
        // rather than taking a control height, so a row of them stays a row of annotations.
        className={cn(shared, 'text-label-small min-w-0 rounded-full px-2 py-0.5', className)}
      >
        <LabelDot />
        <span className="truncate">{name}</span>
      </span>
    );
  }

  // The Chip recipe: 8px corners, a control height, a leading mark. Pressable.
  const body = (
    <>
      <LabelDot />
      <span className="truncate">{name}</span>
    </>
  );
  const chipClass = cn(
    shared,
    'text-label-large h-8 min-w-0 rounded-lg px-2.5',
    'focus-visible:ring-secondary outline-none focus-visible:ring-2',
    className,
  );

  // A removable chip is two controls, so it cannot be one button — a nested button is invalid
  // and a single click target could not tell "filter by this" from "take this off".
  if (onRemove) {
    return (
      <span data-label-color={colorAttr} className={chipClass}>
        <LabelDot />
        {onActivate ? (
          <button
            type="button"
            onClick={onActivate}
            className="min-w-0 truncate outline-none hover:underline focus-visible:underline"
          >
            {name}
          </button>
        ) : (
          <span className="truncate">{name}</span>
        )}
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel ?? `Remove label ${name}`}
          className="-mr-1 shrink-0 rounded-sm p-0.5 opacity-60 outline-none hover:opacity-100 focus-visible:opacity-100"
        >
          <svg viewBox="0 0 16 16" className="size-3" aria-hidden="true">
            <path
              d="M4 4l8 8M12 4l-8 8"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </span>
    );
  }

  if (onActivate) {
    return (
      <button type="button" data-label-color={colorAttr} onClick={onActivate} className={chipClass}>
        {body}
      </button>
    );
  }

  return (
    <span data-label-color={colorAttr} className={chipClass}>
      {body}
    </span>
  );
}

/** Props for {@link LabelChipRow}. */
export interface LabelChipRowProps {
  /** The labels to render, already in display order. */
  labels: readonly { id: string; name: string; color?: string | null }[];
  /**
   * How many chips to show before collapsing the rest into a `+N`. Defaults to 2, which is what
   * a list row's metadata band can carry without crowding out the title.
   */
  max?: number;
  /** Extra classes for the wrapper. */
  className?: string;
}

/**
 * Render a row's labels, collapsing the overflow into a `+N`.
 *
 * @remarks
 * A list row has a fixed metadata budget, and a task carrying six labels must not push its own
 * title out of view. The overflow marker carries the hidden names in its `title` so the full set
 * is still recoverable without a navigation.
 *
 * @param props - The {@link LabelChipRowProps}.
 * @returns The rendered chips, or null when there are none.
 */
export function LabelChipRow({
  labels,
  max = 2,
  className,
}: LabelChipRowProps): React.JSX.Element | null {
  if (labels.length === 0) return null;
  const shown = labels.slice(0, max);
  const hidden = labels.slice(max);
  return (
    <span className={cn('flex min-w-0 items-center gap-1', className)}>
      {shown.map((l) => (
        <LabelChip key={l.id} name={l.name} color={l.color} className="max-w-32" />
      ))}
      {hidden.length > 0 ? (
        <span
          className="text-on-surface-variant text-label-small shrink-0 tabular-nums"
          title={hidden.map((l) => l.name).join(', ')}
        >
          +{hidden.length}
        </span>
      ) : null}
    </span>
  );
}
