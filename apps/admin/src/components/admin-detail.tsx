'use client';

import { ArrowRight, Check, Copy } from '@docket/ui/icons';
import {
  Button,
  Skeleton,
  Stack,
  Text,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@docket/ui/primitives';
import Link from 'next/link';
import { type JSX, type ReactNode, useState } from 'react';

/** Props for {@link DetailBackLink}. */
export interface DetailBackLinkProps {
  /** Where the link returns to. */
  readonly href: string;
  /** What the destination is, e.g. `organizations`. */
  readonly label: string;
}

/**
 * The return path from a detail screen to the list it came from.
 *
 * @param props - See {@link DetailBackLinkProps}.
 * @returns the back link.
 */
export function DetailBackLink({ href, label }: DetailBackLinkProps): JSX.Element {
  return (
    <Button asChild variant="ghost" controlSize="sm" className="w-fit self-start">
      <Link href={href}>
        <ArrowRight aria-hidden="true" className="size-4 rotate-180" />
        Back to {label}
      </Link>
    </Button>
  );
}

/** Props for {@link PropertyList}. */
export interface PropertyListProps {
  /** The {@link Property} entries. */
  readonly children: ReactNode;
}

/**
 * A definition list of read-only facts about the thing being inspected.
 *
 * @remarks
 * A real `<dl>` rather than a grid of loose spans, so each label is programmatically tied to its
 * value. The columns collapse to one at narrow panel widths, measured against the shell's content
 * panel rather than the viewport.
 *
 * @param props - See {@link PropertyListProps}.
 * @returns the property list.
 */
export function PropertyList({ children }: PropertyListProps): JSX.Element {
  return <dl className="grid grid-cols-1 gap-4 @lg:grid-cols-2 @3xl:grid-cols-3">{children}</dl>;
}

/** Props for {@link Property}. */
export interface PropertyProps {
  /** The field's name. */
  readonly label: string;
  /** The field's value, already formatted for display. */
  readonly value: string;
  /**
   * Render the value as a copyable identifier.
   *
   * @remarks
   * Identifiers are the values an operator most often needs somewhere else — a Stripe dashboard, a
   * support thread, a database query — and selecting a truncated one by hand is exactly where
   * transcription errors come from. Marking it here makes it monospaced and gives it a copy
   * control.
   */
  readonly identifier?: boolean | undefined;
  /** Clamp a long value to one line, for a fact shown in a narrow column. */
  readonly truncate?: boolean | undefined;
}

/**
 * One labelled fact.
 *
 * @param props - See {@link PropertyProps}.
 * @returns the label/value pair.
 */
export function Property({
  label,
  value,
  identifier = false,
  truncate = false,
}: PropertyProps): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <Text as="dt" token="label-small" tone="muted">
        {label}
      </Text>
      <dd className="min-w-0">
        {identifier ? (
          <CopyableValue value={value} />
        ) : (
          <Text token="body-medium" truncate={truncate}>
            {value}
          </Text>
        )}
      </dd>
    </div>
  );
}

/** How long the copy control confirms a successful copy before returning to rest. */
const COPIED_FEEDBACK_MS = 1500;

/** A monospaced identifier with a copy control that confirms what it did. */
function CopyableValue({ value }: { readonly value: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  async function copy(): Promise<void> {
    setFailed(false);
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, COPIED_FEEDBACK_MS);
    } catch {
      // A denied clipboard permission is the common case, and silently doing nothing would read as
      // a successful copy — the operator would paste whatever was there before.
      setFailed(true);
    }
  }

  return (
    <div className="flex min-w-0 items-center gap-1">
      <Text token="body-small" truncate className="min-w-0 font-mono" title={value}>
        {value}
      </Text>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            controlSize="xs"
            iconOnly
            aria-label={`Copy ${value}`}
            onClick={() => void copy()}
          >
            {copied ? (
              <Check aria-hidden="true" className="size-3.5" />
            ) : (
              <Copy aria-hidden="true" className="size-3.5" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{copyTooltip(copied, failed)}</TooltipContent>
      </Tooltip>
    </div>
  );
}

/** What the copy control's tooltip should say for the control's current state. */
function copyTooltip(copied: boolean, failed: boolean): string {
  if (failed) return 'Could not copy — your browser blocked clipboard access';
  if (copied) return 'Copied';
  return 'Copy';
}

/** Props for {@link DetailSkeleton}. */
export interface DetailSkeletonProps {
  /** How many placeholder panels to draw beneath the title. */
  readonly panels?: number | undefined;
}

/**
 * A loading placeholder for a detail screen.
 *
 * @param props - See {@link DetailSkeletonProps}.
 * @returns the placeholder.
 */
export function DetailSkeleton({ panels = 2 }: DetailSkeletonProps): JSX.Element {
  return (
    <Stack gap={4} aria-hidden="true">
      <Skeleton className="h-8 w-64 rounded-md" />
      {Array.from({ length: panels }, (_, index) => (
        <Skeleton key={index} className="h-28 w-full rounded-xl" />
      ))}
    </Stack>
  );
}
