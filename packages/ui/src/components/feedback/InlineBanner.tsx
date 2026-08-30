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
  /** Invoked when the user selects the action. */
  readonly onSelect: () => void;
}

/** Props for {@link InlineBanner}. */
export interface InlineBannerProps {
  /** The banner's semantic urgency. */
  readonly tone: InlineBannerTone;
  /** The short status heading announced before the message. */
  readonly title: string;
  /** The explanatory message. */
  readonly children: ReactNode;
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

/**
 * An inline status region with independently reachable action and dismissal controls.
 *
 * @param props - The banner content and optional controls.
 * @returns a single, non-scrolling status region.
 */
export function InlineBanner({
  tone,
  title,
  children,
  icon,
  action,
  dismissLabel,
  onDismiss,
}: InlineBannerProps): React.JSX.Element {
  const canDismiss = dismissLabel !== undefined && onDismiss !== undefined;

  return (
    <Surface
      as="section"
      tone="floating"
      shape="small"
      pad="comfortable"
      role="status"
      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1.5 shadow-level1"
    >
      {icon ? <span className={`mt-0.5 shrink-0 ${TONE_CLASS[tone]}`}>{icon}</span> : null}
      <div className={icon ? 'min-w-0' : 'col-span-2 min-w-0'}>
        <p className="text-label-medium text-on-surface">{title}</p>
        <div className="text-on-surface-variant text-body-small mt-0.5 min-w-0">{children}</div>
      </div>
      {canDismiss ? (
        <Button
          type="button"
          variant="ghost"
          controlSize="xl"
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
          controlSize="md"
          onClick={action.onSelect}
          className={icon ? 'col-start-2 justify-self-start px-0' : 'col-span-2 justify-self-start px-0'}
        >
          {action.label}
        </Button>
      ) : null}
    </Surface>
  );
}
