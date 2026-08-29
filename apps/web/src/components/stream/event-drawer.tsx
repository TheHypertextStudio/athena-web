'use client';

/** `stream` — auditable exact-event inspection without timeline repetition. */
import { OpenInNew, X } from '@docket/ui/icons';
import {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  focusRing,
} from '@docket/ui/primitives';
import { cn } from '@docket/ui';
import type { JSX } from 'react';

import Link from '@/components/docket-link';

import { AthenaPlan } from './athena-plan';
import { ProviderBadge } from './provider-badge';
import {
  KIND_LABEL,
  streamDescription,
  streamEventDetailLabel,
  streamHref,
  type StreamEventRow,
} from './stream-meta';

/** Build the agent brief from an event for the drafted-plan panel. */
function planPrompt(row: StreamEventRow): string {
  const parts = [streamDescription(row), streamEventDetailLabel(row), row.summary].filter(
    (part): part is string => Boolean(part),
  );
  const href = streamHref(row);
  if (href) parts.push(`Link: ${href}`);
  return parts.join('. ');
}

/** Props for {@link EventDrawer}. */
export interface EventDrawerProps {
  readonly row: StreamEventRow | null;
  readonly onClose: () => void;
}

/** The expanded exact-event drawer, including source, local timestamp, detail, and Athena. */
export function EventDrawer({ row, onClose }: EventDrawerProps): JSX.Element | null {
  if (!row) return null;
  const href = streamHref(row);
  const detail = streamEventDetailLabel(row);
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent presentation="responsive-fullscreen" size="standard" side="right">
        <SheetHeader className="border-outline-variant flex-row items-center gap-2 border-b">
          <div className="min-w-0 flex-1">
            <SheetTitle className="sr-only">Event details</SheetTitle>
            <SheetDescription className="sr-only">Inspect the selected event.</SheetDescription>
          </div>
          <ProviderBadge system={row.system} />
          <span className="text-on-surface-variant text-label-small">{KIND_LABEL[row.kind]}</span>
          <SheetClose asChild>
            <button
              type="button"
              aria-label="Close event details"
              className={cn(
                'text-on-surface-variant hover:bg-surface-container ml-auto flex size-10 items-center justify-center rounded-full outline-none',
                focusRing,
              )}
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </SheetClose>
        </SheetHeader>

        <SheetBody className="p-5">
          <h2 className="text-on-surface text-title-medium">{streamDescription(row)}</h2>
          <time
            dateTime={row.occurredAt}
            className="text-on-surface-variant text-label-small mt-1 block"
          >
            {new Date(row.occurredAt).toLocaleString()}
          </time>

          {row.entityTitle ? (
            <div className="border-outline-variant mt-5 border-t pt-4">
              <p className="text-on-surface-variant text-label-small">Subject</p>
              {href ? (
                <Link
                  href={href}
                  className={cn(
                    'text-primary text-body-medium mt-1 inline-flex min-h-10 items-center gap-1 rounded-sm outline-none',
                    focusRing,
                  )}
                >
                  {row.entityTitle}
                  <OpenInNew className="size-4" aria-hidden="true" />
                </Link>
              ) : (
                <p className="text-on-surface text-body-medium mt-1">{row.entityTitle}</p>
              )}
            </div>
          ) : null}

          {detail ? (
            <div className="bg-surface-container-low mt-4 rounded-lg p-3">
              <p className="text-on-surface text-body-small whitespace-pre-wrap">{detail}</p>
            </div>
          ) : null}

          <div className="border-outline-variant mt-5 border-t pt-5">
            <AthenaPlan orgId={row.organizationId} prompt={planPrompt(row)} />
          </div>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
