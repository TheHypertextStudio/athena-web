import { Badge, buttonVariants } from '@docket/ui/primitives';
import Link from 'next/link';
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
 * The shared row class for every clickable list row across the operator console.
 *
 * @remarks
 * Keeps the surface tone, hover feedback, and keyboard focus ring consistent for every
 * `<Link>`-based row (org/user lists, dashboard queues, lifecycle cards, memberships, holds).
 * Sits on the recessed `surface-container-low` well with an `outline-variant` hairline, brightens
 * to `surface-container-high` on hover, and carries a `focus-visible` ring so keyboard users get a
 * visible focus indicator everywhere. Rounding and padding are left to the caller so dense rows and
 * card-style rows can size themselves.
 */
export const ROW_CLASS =
  'border-outline-variant bg-surface-container-low text-on-surface hover:bg-surface-container-high focus-visible:ring-ring flex border transition-colors focus-visible:outline-none focus-visible:ring-1';

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
        <h1 className="text-on-surface text-h1">{title}</h1>
        {description ? <p className="text-on-surface-variant text-body">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** Props for {@link ErrorBanner}. */
export interface ErrorBannerProps {
  /** The error message to surface, or `null`/`undefined` to render nothing. */
  message: string | null | undefined;
  /**
   * An optional recovery affordance rendered alongside the message (e.g. a "Sign in" link for a
   * 401/403). When present the banner becomes a flex row so the action sits at the trailing edge.
   */
  action?: ReactNode;
}

/**
 * An inline error banner with `role="alert"`, or nothing when there is no message.
 *
 * @remarks
 * When an {@link ErrorBannerProps.action | action} is supplied (e.g. a sign-in link for an
 * unauthenticated/non-staff visitor) it is rendered at the banner's trailing edge so the operator
 * always has a way forward rather than being stranded on an error with no recovery path.
 *
 * @param props - See {@link ErrorBannerProps}.
 * @returns the alert banner, or `null` when `message` is absent.
 */
export function ErrorBanner({ message, action }: ErrorBannerProps): JSX.Element | null {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="border-destructive/40 bg-destructive/5 text-destructive text-body flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
    >
      <p>{message}</p>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

/**
 * A "Sign in" recovery link, sized to sit inside an {@link ErrorBanner}'s action slot.
 *
 * @remarks
 * Surfaced when an admin call fails with 401/403 (typically a signed-in but non-staff account):
 * the operator can re-authenticate with a staff account instead of being stranded on the error.
 * Uses the shared {@link buttonVariants} so it matches the app's buttons and carries a focus ring.
 *
 * @returns a small outline-styled link to `/sign-in`.
 */
export function SignInAction(): JSX.Element {
  return (
    <Link href="/sign-in" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
      Sign in
    </Link>
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
    <p className="border-outline-variant text-on-surface-variant text-body rounded-lg border border-dashed p-6 text-center">
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
