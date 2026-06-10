'use client';

/**
 * The shared right-rail property panel shell + labeled row.
 *
 * @remarks
 * Directive A: a detail surface's property rail must read as a complete, scannable list where
 * every property is an *interactive* affordance — never a dead "Not set" row. This is the
 * common chrome the project / program / initiative / cycle detail panels share: a calm bordered
 * card titled "Properties", a stack of {@link PropertyPanelRow}s (a muted icon + a calm field
 * label gutter, then the value), with a hairline between rows. The value slot hosts an inline picker
 * trigger (ghost weight) so an empty property renders as a calm "Set <field>" prompt that opens
 * a picker, and a set property renders its value chip — both clickable unless the row is
 * capability-gated read-only, in which case the picker itself renders plain text.
 */
import { cn } from '@docket/ui';
import type { JSX, ReactNode } from 'react';

/** Props for {@link PropertyPanel}. */
export interface PropertyPanelProps {
  /** The labeled property rows (each a {@link PropertyPanelRow}). */
  children: ReactNode;
  /** Extra classes merged onto the card. */
  className?: string;
}

/**
 * The bordered "Properties" card that wraps a stack of labeled rows.
 *
 * @param props - The {@link PropertyPanelProps}.
 * @returns the rendered panel card.
 */
export function PropertyPanel({ children, className }: PropertyPanelProps): JSX.Element {
  return (
    <div
      className={cn(
        'border-outline-variant bg-surface-container-low flex flex-col rounded-xl border px-4 py-2',
        className,
      )}
    >
      <h2 className="sr-only">Properties</h2>
      {children}
    </div>
  );
}

/** Props for {@link PropertyPanelRow}. */
export interface PropertyPanelRowProps {
  /** The leading field glyph (a muted MUI icon). */
  icon: ReactNode;
  /** The field label (e.g. "Lead", "Timeline"). */
  label: string;
  /** The value slot — typically an inline picker trigger. */
  children: ReactNode;
  /** Whether to draw a hairline divider above this row (all but the first). */
  divided?: boolean;
}

/**
 * One labeled property row: a muted icon + a calm field label, then an interactive value slot.
 *
 * @remarks
 * The value slot is left-padded to align with picker triggers (which carry their own
 * `px-2`), so a column of pickers reads as quiet, tappable text rather than a wall of boxes.
 *
 * @param props - The {@link PropertyPanelRowProps}.
 * @returns the rendered row.
 */
export function PropertyPanelRow({
  icon,
  label,
  children,
  divided,
}: PropertyPanelRowProps): JSX.Element {
  return (
    <>
      {divided ? <div className="border-outline-variant border-t" /> : null}
      <div className="flex items-start gap-3 py-2.5">
        <span aria-hidden="true" className="text-on-surface-variant mt-0.5 flex size-4 shrink-0">
          {icon}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-on-surface-variant text-xs font-medium">{label}</span>
          <div className="text-on-surface text-body -ml-2 min-w-0">{children}</div>
        </div>
      </div>
    </>
  );
}
