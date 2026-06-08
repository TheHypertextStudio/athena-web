'use client';

/**
 * One passive row in the cross-org Activity feed.
 *
 * @remarks
 * The Activity feed is awareness, not action: a quiet, newest-first stream of what happened
 * across every org the caller belongs to. Each row renders one {@link AuditEventOut} as a
 * plain-English line (verb + subject, via {@link activityDescription}), org-chipped and
 * time-stamped, linking to the subject's home when one exists. Approval/rejection events
 * adopt a subtle token tint so resolved agent decisions read at a glance, but nothing here
 * is interactive beyond navigating onward — the actionable queue lives on the Inbox tab.
 */
import type { AuditEventOut } from '@docket/types';
import { CheckCircle2, type LucideIcon, Sparkles, XCircle } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import Link from 'next/link';
import { type JSX, type ReactNode } from 'react';

import { OrgChip } from '@/components/org-chip';

import { relativeTime } from '../agents/format-time';
import { activityDescription, activityHref } from './notification-meta';

/** The leading glyph + tone for an audit event, keyed off notable event types. */
function glyphFor(type: AuditEventOut['type']): { icon: LucideIcon; tone: string } {
  switch (type) {
    case 'approved':
      return { icon: CheckCircle2, tone: 'text-state-completed' };
    case 'rejected':
    case 'deleted':
      return { icon: XCircle, tone: 'text-on-surface-variant' };
    default:
      return { icon: Sparkles, tone: 'text-on-surface-variant' };
  }
}

/** Props for {@link ActivityRow}. */
export interface ActivityRowProps {
  /** The audit event to render. */
  readonly event: AuditEventOut;
  /** The originating org's display name (for the chip). */
  readonly orgName: string;
}

/**
 * A single passive Activity-feed row — a plain-English event line, org-chipped + stamped.
 */
export function ActivityRow({ event, orgName }: ActivityRowProps): JSX.Element {
  const { icon: Icon, tone } = glyphFor(event.type);
  const href = activityHref(event);
  const description = activityDescription(event);

  return (
    <RowShell href={href}>
      <span
        aria-hidden="true"
        className="bg-surface-container mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
      >
        <Icon className={cn('h-4 w-4', tone)} />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-on-surface/90 text-sm leading-snug">{description}</p>
        <div className="flex flex-wrap items-center gap-2">
          <OrgChip orgId={event.organizationId} name={orgName} />
          <span aria-hidden="true" className="text-on-surface-variant/50 text-xs">
            ·
          </span>
          <span className="text-on-surface-variant text-xs">{relativeTime(event.createdAt)}</span>
        </div>
      </div>
    </RowShell>
  );
}

/** Render the row as a focusable link to its subject, or as an inert container when none. */
function RowShell({ href, children }: { href: string | null; children: ReactNode }): JSX.Element {
  const base = 'flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors';
  if (!href) return <div className={base}>{children}</div>;
  return (
    <Link
      href={href}
      className={cn(
        base,
        'hover:bg-surface-container-high focus-visible:ring-ring focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none',
      )}
    >
      {children}
    </Link>
  );
}
