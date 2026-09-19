'use client';

/**
 * `@docket/ui` — a compact, actionable inline status banner.
 *
 * @remarks
 * The banner owns its tonal surface, shape, internal axis, close target, and action placement.
 * A caller chooses the outside inset by placing this component in its layout. Keeping that split
 * prevents nested padding and negative offsets from clipping content in narrow navigation sheets.
 */
import { X } from '../../icons';
import { Button } from '../../primitives/button';
import { Surface } from '../../primitives/surface';
import type { ReactNode } from 'react';

/** The semantic urgency of an inline status banner. */
export type InlineBannerTone = 'info' | 'warning' | 'critical';

/** An optional recovery action displayed below a banner's copy. */
export interface InlineBannerAction {
  /** The action label. */
  readonly label: string;
  /** A fuller accessible name, for a banner that repeats among siblings that share one label. */
  readonly ariaLabel?: string | undefined;
  /** Invoked when the user selects the action. */
  readonly onSelect: () => void;
}

/** How much room a banner takes: `comfortable` in a page, `compact` inside an overlay list. */
export type InlineBannerDensity = 'comfortable' | 'compact';

/** Props for {@link InlineBanner}. */
export interface InlineBannerProps {
  /** The banner's semantic urgency. */
  readonly tone: InlineBannerTone;
  /** Default `comfortable`. */
  readonly density?: InlineBannerDensity | undefined;
  /** The short status heading announced before the message. */
  readonly title: string;
  /** The explanatory message. Omit it when the title says everything. */
  readonly children?: ReactNode | undefined;
  /** An optional leading icon. */
  readonly icon?: ReactNode | undefined;
  /** An optional action. */
  readonly action?: InlineBannerAction | undefined;
  /** Accessible name for the optional dismissal control. */
  readonly dismissLabel?: string | undefined;
  /** Handles dismissal when supplied with {@link InlineBannerProps.dismissLabel}. */
  readonly onDismiss?: (() => void) | undefined;
}

const TONE_CLASS: Readonly<Record<InlineBannerTone, string>> = {
  info: 'text-primary',
  warning: 'text-on-surface-variant',
  critical: 'text-error',
};

/** The banner's explanatory message; a banner whose title says everything renders none. */
function BannerMessage({ children }: { readonly children: ReactNode }): React.JSX.Element | null {
  if (children === undefined || children === null) return null;
  return <div className="text-on-surface-variant text-body-small mt-0.5 min-w-0">{children}</div>;
}

/**
 * An inline status region with independently reachable action and dismissal controls.
 *
 * @param props - The banner content and optional controls.
 * @returns a single, non-scrolling status region.
 */
export function InlineBanner({
  tone,
  density = 'comfortable',
  title,
  children,
  icon,
  action,
  dismissLabel,
  onDismiss,
}: InlineBannerProps): React.JSX.Element {
  const canDismiss = dismissLabel !== undefined && onDismiss !== undefined;
  const compact = density === 'compact';

  return (
    <Surface
      as="section"
      tone="floating"
      shape="small"
      pad={compact ? 'tight' : 'comfortable'}
      data-density={density}
      // A critical banner reports something that failed, so it interrupts; every other tone is
      // informational and waits its turn. Announcing an error politely means a screen-reader user
      // hears it only after whatever they were already reading, which for a failed action is after
      // they have moved on.
      role={tone === 'critical' ? 'alert' : 'status'}
      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1.5"
    >
      {icon ? <span className={`mt-0.5 shrink-0 ${TONE_CLASS[tone]}`}>{icon}</span> : null}
      <div className={icon ? 'min-w-0' : 'col-span-2 min-w-0'}>
        <p className="text-label-medium text-on-surface">{title}</p>
        <BannerMessage>{children}</BannerMessage>
      </div>
      {canDismiss ? (
        <Button
          type="button"
          variant="ghost"
          controlSize={compact ? 'sm' : 'xl'}
          iconOnly
          aria-label={dismissLabel}
          onClick={onDismiss}
          className="shrink-0"
        >
          <X aria-hidden="true" />
        </Button>
      ) : null}
      {action ? (
        <Button
          type="button"
          variant="link"
          controlSize={compact ? 'sm' : 'md'}
          aria-label={action.ariaLabel}
          onClick={action.onSelect}
          className={
            icon ? 'col-start-2 justify-self-start px-0' : 'col-span-2 justify-self-start px-0'
          }
        >
          {action.label}
        </Button>
      ) : null}
    </Surface>
  );
}
