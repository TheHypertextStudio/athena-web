/**
 * `@docket/ui` — EmptyState atom (the shared calm empty-state pattern).
 *
 * @remarks
 * The single, consistent empty-state treatment used across Docket's surfaces: a glyph in a
 * muted tonal disc, a short `font-medium` title, and a one-line `on-surface-variant` subtext —
 * the richer pattern already used by My Work, Projects, Inbox, and Portfolio. Centralizing it
 * here keeps thinner surfaces (the Agents feed, the Session activity stream) visually consistent
 * with the rest of the polished app instead of falling back to plain centered text.
 *
 * All colors come from the semantic MD3 surface tokens in `@docket/ui/styles/globals.css`; the
 * glyph is supplied by the caller (a `@docket/ui/icons` MUI glyph) so each surface reads with
 * the right metaphor. An optional `action` slot hosts a CTA (e.g. a create button).
 *
 * @example
 * ```tsx
 * <EmptyState
 *   icon={Sparkles}
 *   title="No agent sessions yet"
 *   body="When an agent picks up work, you can watch it happen here."
 * />
 * ```
 */
import * as React from 'react';

import { cn } from '../../lib/utils';

/** Props for {@link EmptyState}. */
export interface EmptyStateProps {
  /** The leading glyph (a `@docket/ui/icons` MUI component) shown in the muted disc. */
  readonly icon: React.ComponentType<{ className?: string }>;
  /** The empty-state headline. */
  readonly title: string;
  /** The one-line supporting copy below the title. */
  readonly body: string;
  /** Optional CTA slot rendered below the copy (e.g. a create button). */
  readonly action?: React.ReactNode;
  /** Extra class names merged onto the outer container. */
  readonly className?: string;
}

/**
 * A calm, centered empty state: a glyph disc, a title, supporting copy, and an optional action.
 *
 * @remarks
 * Renders inside a dashed-border panel so it reads as an intentional empty surface rather than a
 * loading or broken state. The icon is decorative (`aria-hidden`), so the title + body carry the
 * accessible meaning.
 */
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  className,
}: EmptyStateProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'border-outline-variant flex flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="bg-surface-container-high text-on-surface-variant flex size-10 items-center justify-center rounded-full"
      >
        <Icon className="size-5" />
      </span>
      <p className="text-on-surface text-sm font-medium">{title}</p>
      <p className="text-on-surface-variant max-w-xs text-sm leading-relaxed">{body}</p>
      {action}
    </div>
  );
}
