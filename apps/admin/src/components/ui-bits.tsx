import { Badge } from '@docket/ui/primitives';
import type { JSX, ReactNode } from 'react';

import { type LifecycleState, lifecycleBadgeVariant, lifecycleLabel } from '@/lib/lifecycle';

/** Props for {@link PageHeader}. */
export interface PageHeaderProps {
  /** The screen's heading. */
  title: string;
  /** An optional one-line description shown under the title. */
  description?: string;
  /** Optional right-aligned actions (e.g. a search field or button). */
  actions?: ReactNode;
}

/**
 * A consistent screen header: a title, optional description, and optional right-aligned
 * actions.
 *
 * @param props - See {@link PageHeaderProps}.
 * @returns the header region rendered at the top of every operator screen.
 */
export function PageHeader({ title, description, actions }: PageHeaderProps): JSX.Element {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** Props for {@link ErrorBanner}. */
export interface ErrorBannerProps {
  /** The error message to surface, or `null`/`undefined` to render nothing. */
  message: string | null | undefined;
}

/**
 * An inline error banner with `role="alert"`, or nothing when there is no message.
 *
 * @param props - See {@link ErrorBannerProps}.
 * @returns the alert banner, or `null` when `message` is absent.
 */
export function ErrorBanner({ message }: ErrorBannerProps): JSX.Element | null {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="border-destructive/40 bg-destructive/5 text-destructive rounded-lg border p-3 text-sm"
    >
      {message}
    </p>
  );
}

/** Props for {@link EmptyState}. */
export interface EmptyStateProps {
  /** The message shown in the empty placeholder. */
  message: string;
}

/**
 * A dashed-border empty-state placeholder for zero-result lists.
 *
 * @param props - See {@link EmptyStateProps}.
 * @returns the centered empty-state placeholder.
 */
export function EmptyState({ message }: EmptyStateProps): JSX.Element {
  return (
    <p className="border-border text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
      {message}
    </p>
  );
}

/** Props for {@link LifecycleBadge}. */
export interface LifecycleBadgeProps {
  /** The lifecycle state to render. */
  state: LifecycleState;
}

/**
 * A {@link Badge} whose label and variant reflect an org's data-lifecycle state.
 *
 * @param props - See {@link LifecycleBadgeProps}.
 * @returns the lifecycle-state pill.
 */
export function LifecycleBadge({ state }: LifecycleBadgeProps): JSX.Element {
  return <Badge variant={lifecycleBadgeVariant(state)}>{lifecycleLabel(state)}</Badge>;
}
