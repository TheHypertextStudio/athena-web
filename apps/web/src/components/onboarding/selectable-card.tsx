'use client';

/**
 * `onboarding/selectable-card` — the large, accessible choice card used across the wizard.
 *
 * @remarks
 * Both the intent fork (step 1) and the vocabulary picker present a row of mutually-exclusive
 * options; this is the single styled, accessible control behind them. It is a real `<button>`
 * (keyboard-focusable, Enter/Space activatable) carrying `aria-pressed` to announce its
 * selected state, with a token-driven selected treatment and a visible focus ring.
 */
import { Check, type LucideIcon } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import type { JSX, ReactNode } from 'react';

/** Props for {@link SelectableCard}. */
export interface SelectableCardProps {
  /** Whether this card is the currently-selected option. */
  selected: boolean;
  /** Invoked when the card is activated (click / Enter / Space). */
  onSelect: () => void;
  /** The card's headline. */
  title: string;
  /** A short supporting sentence under the title. */
  description: string;
  /** An optional leading glyph rendered in a tinted badge. */
  icon?: LucideIcon;
  /** Optional extra content (e.g. a vocabulary preview) rendered below the description. */
  children?: ReactNode;
  /** Optional extra classes (e.g. layout/sizing from the parent grid). */
  className?: string;
}

/**
 * A large, single-select choice card with an accessible pressed state.
 *
 * @remarks
 * Selection is communicated three ways for redundancy: the bordered/tinted surface, a check
 * badge in the corner, and `aria-pressed` for assistive tech. The corner badge always
 * occupies its slot so selecting a card does not shift layout.
 */
export function SelectableCard({
  selected,
  onSelect,
  title,
  description,
  icon: Icon,
  children,
  className,
}: SelectableCardProps): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'focus-visible:ring-ring group relative flex flex-col gap-3 rounded-xl border p-5 text-left transition-all duration-200 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
        selected
          ? 'border-primary bg-surface-container-highest shadow-sm'
          : 'border-outline-variant hover:border-outline hover:bg-surface-container-high hover:shadow-sm',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute top-4 right-4 flex size-5 items-center justify-center rounded-full border transition-all duration-200',
          selected
            ? 'border-primary bg-primary text-primary-foreground scale-100 opacity-100'
            : 'border-outline-variant scale-90 opacity-0 group-hover:opacity-40',
        )}
      >
        <Check className="size-3" />
      </span>

      {Icon ? (
        <span
          aria-hidden
          className={cn(
            'flex size-10 items-center justify-center rounded-lg border transition-colors duration-200',
            selected
              ? 'border-primary/30 bg-primary/10 text-primary'
              : 'border-outline-variant bg-surface-container-high text-on-surface-variant group-hover:text-on-surface',
          )}
        >
          <Icon className="size-5" />
        </span>
      ) : null}

      <span className="flex flex-col gap-1 pr-6">
        <span className="text-on-surface text-base leading-tight font-semibold">{title}</span>
        <span className="text-on-surface-variant text-sm leading-relaxed">{description}</span>
      </span>

      {children}
    </button>
  );
}
