'use client';

import { cn } from '@docket/ui';
import { Sparkles } from '@docket/ui/icons';
import { Button, DropdownMenuItem } from '@docket/ui/primitives';
import type { JSX } from 'react';

import type { PersonalAthenaContext } from '@/lib/athena/presentation';

import { useAthenaPanel } from './athena-panel-provider';

/** Props for a contextual door into the one personal Athena dock. */
export interface AthenaContextActionProps {
  readonly label: string;
  readonly context?: PersonalAthenaContext | null;
  readonly variant?: 'ghost' | 'outline';
  /** Extra classes for the button, so a host row can impose its own shared control geometry. */
  readonly className?: string;
  /**
   * Short visible wording, revealed only from {@link AthenaContextActionProps.labelFrom}; below that
   * the control is its glyph alone, named by `label`.
   *
   * @remarks
   * A control in a never-wrapping row has exactly two honest responses to a narrow container:
   * collapse to its glyph, or leave. This used to have neither — the label was unconditional and the
   * *caller* hid the whole control, so on a docked-rail desktop the Athena door vanished while every
   * neighbour beside it was still visible as an icon. Omit both and the control keeps its original
   * always-labelled shape.
   */
  readonly text?: string;
  /** Container-query breakpoint at which {@link AthenaContextActionProps.text} appears. */
  readonly labelFrom?: '@2xl' | '@4xl';
}

/** Props for a contextual Athena row inside an action menu. */
export type AthenaContextMenuItemProps = Pick<AthenaContextActionProps, 'label' | 'context'>;

/** Open the shared personal Athena dock with the current workspace or object attached. */
export function AthenaContextAction({
  label,
  context = null,
  variant = 'outline',
  className,
  text,
  labelFrom = '@2xl',
}: AthenaContextActionProps): JSX.Element {
  const { openAthena } = useAthenaPanel();
  return (
    <Button
      type="button"
      variant={variant}
      size="sm"
      aria-label={text === undefined ? undefined : label}
      className={cn('min-h-10', className)}
      onClick={() => {
        openAthena(context);
      }}
    >
      <Sparkles aria-hidden="true" className="size-4" />
      {text === undefined ? (
        label
      ) : (
        <span className={labelFrom === '@2xl' ? 'hidden @2xl:inline' : 'hidden @4xl:inline'}>
          {text}
        </span>
      )}
    </Button>
  );
}

/** Open the shared personal Athena dock from an overflow menu. */
export function AthenaContextMenuItem({
  label,
  context = null,
}: AthenaContextMenuItemProps): JSX.Element {
  const { openAthena } = useAthenaPanel();

  return (
    <DropdownMenuItem
      onSelect={() => {
        openAthena(context);
      }}
    >
      <Sparkles aria-hidden="true" />
      {label}
    </DropdownMenuItem>
  );
}
