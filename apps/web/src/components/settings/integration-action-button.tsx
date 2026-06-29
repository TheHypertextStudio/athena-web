'use client';

/**
 * `settings` — the compact text-style action button used across the integrations surface.
 *
 * @remarks
 * The integration cards/rows use a small, text-colored, fill-less button (Connect, Sync,
 * Disconnect, Add account, …) that none of the design-system {@link Button} variants cover, so
 * this owns that one style in a single reusable place rather than repeating its utility classes
 * on every `<button>`. `tone` selects the colour; everything else is a normal button prop.
 */
import { cn } from '@docket/ui';
import type { ComponentProps, JSX } from 'react';

/** The colour treatment for an {@link IntegrationActionButton}. */
export type ActionTone = 'primary' | 'muted' | 'danger';

const TONE: Record<ActionTone, string> = {
  primary: 'text-primary hover:bg-surface-container-high',
  muted: 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high',
  danger: 'text-destructive hover:bg-destructive/10',
};

/** Props for {@link IntegrationActionButton}: native button props plus the `tone`. */
export interface IntegrationActionButtonProps extends ComponentProps<'button'> {
  /** Colour treatment (defaults to `primary`). */
  tone?: ActionTone;
}

/** A compact text-style action button (Connect/Sync/Disconnect/Add…) for the integrations surface. */
export function IntegrationActionButton({
  tone = 'primary',
  className,
  type = 'button',
  ...props
}: IntegrationActionButtonProps): JSX.Element {
  return (
    <button
      type={type}
      className={cn(
        'focus-visible:ring-ring text-body inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors outline-none focus-visible:ring-1 disabled:opacity-50',
        TONE[tone],
        className,
      )}
      {...props}
    />
  );
}
