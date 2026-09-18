'use client';

/**
 * `@docket/ui` — the card one notice renders as.
 *
 * @remarks
 * Docket owns the whole card so a notice reads as an MD3 tinted surface rather than a library
 * default. A `critical` card is the error container and announces as an alert; the other tones
 * sit on the floating surface and announce politely.
 */
import { CheckCircle2, CircleAlert, X } from '../../icons';
import { cn } from '../../lib/utils';
import { Button } from '../../primitives/button';
import { Surface } from '../../primitives/surface';
import { Text } from '../../primitives/text';
import type { ReactNode } from 'react';

import type { ToastAction, ToastTone } from './toast';

/** Props for {@link ToastCard}. */
export interface ToastCardProps {
  readonly title: string;
  readonly detail?: string | undefined;
  readonly tone: ToastTone;
  readonly action?: ToastAction | undefined;
  /** Remove the notice. */
  readonly onDismiss: () => void;
  /** Accessible name for the dismiss control. Default "Dismiss". */
  readonly dismissLabel?: string | undefined;
}

/** The surface treatment and glyph for each tone. */
interface ToneTreatment {
  readonly className: string;
  readonly glyph: ReactNode;
  readonly role: 'alert' | 'status';
}

const TONE_TREATMENT: Readonly<Record<ToastTone, ToneTreatment>> = {
  neutral: { className: '', glyph: null, role: 'status' },
  positive: {
    className: '',
    glyph: <CheckCircle2 aria-hidden="true" className="text-state-completed size-5 shrink-0" />,
    role: 'status',
  },
  critical: {
    className: 'bg-error-container text-on-error-container',
    glyph: <CircleAlert aria-hidden="true" className="size-5 shrink-0" />,
    role: 'alert',
  },
};

/** The notice's one action, as a button or a link. */
function ToastActionControl({ action }: { readonly action: ToastAction }): ReactNode {
  if ('href' in action) {
    return (
      <Button asChild variant="link" controlSize="sm" className="px-0">
        <a href={action.href}>{action.label}</a>
      </Button>
    );
  }
  return (
    <Button
      type="button"
      variant="link"
      controlSize="sm"
      className="px-0"
      onClick={action.onSelect}
    >
      {action.label}
    </Button>
  );
}

/**
 * One notice.
 *
 * @param props - The notice and its dismiss control.
 * @returns a self-contained card the toaster positions.
 */
export function ToastCard({
  title,
  detail,
  tone,
  action,
  onDismiss,
  dismissLabel = 'Dismiss',
}: ToastCardProps): React.JSX.Element {
  const treatment = TONE_TREATMENT[tone];
  return (
    <Surface
      tone="floating"
      shape="small"
      pad="comfortable"
      role={treatment.role}
      data-toast-tone={tone}
      className={cn(
        'grid w-[min(92vw,22rem)] grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1',
        treatment.className,
      )}
    >
      {treatment.glyph ? <span className="mt-0.5">{treatment.glyph}</span> : <span />}
      <div className="min-w-0">
        <Text as="p" token="label-large" tone="inherit">
          {title}
        </Text>
        {detail ? (
          <Text as="p" token="body-small" tone="inherit" className="mt-0.5 opacity-90">
            {detail}
          </Text>
        ) : null}
        {action ? (
          <div className="mt-1">
            <ToastActionControl action={action} />
          </div>
        ) : null}
      </div>
      <Button
        type="button"
        variant="ghost"
        iconOnly
        controlSize="sm"
        aria-label={dismissLabel}
        onClick={onDismiss}
        className="-mt-1 -mr-1 shrink-0 text-inherit"
      >
        <X aria-hidden="true" />
      </Button>
    </Surface>
  );
}
