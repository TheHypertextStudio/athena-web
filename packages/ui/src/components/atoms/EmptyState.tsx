/**
 * `@docket/ui` — EmptyState atom (the canonical, differentiable empty-state pattern).
 *
 * @remarks
 * The single, consistent empty-state treatment used across every Docket surface: a glyph in a
 * toned disc, a short `font-medium` title, a one-line `on-surface-variant` subtext, and an
 * optional primary action. Centralizing it here keeps thin surfaces (the Agents feed, the Session
 * activity stream) visually consistent with the richer ones (My Work, Projects, Inbox, Portfolio)
 * instead of falling back to plain centered text or a hand-rolled dashed panel.
 *
 * The structure is fixed so every empty state reads as the same component family, but it allows
 * *per-feature character* without a bespoke component each time:
 *
 * - `icon` is optional — omit it for a neutral surface (a sensible default glyph stands in) or
 *   pass a `@docket/ui/icons` MUI glyph that carries the right metaphor.
 * - `tone` tints the glyph disc (`neutral` | `positive` | `accent`) so a celebratory "Inbox zero"
 *   can read warmer than a plain "nothing yet", while the layout stays identical.
 * - `cta` renders a single primary {@link Button} (the common "create your first …" case); for
 *   anything richer (a secondary link, two buttons) pass an `action` node instead.
 *
 * All colors come from the semantic MD3 surface tokens in `@docket/ui/styles/globals.css`; the
 * glyph is decorative (`aria-hidden`), so the title + body carry the accessible meaning. The disc
 * glyph sits at the empty-state hero size (`size-6`, 24px) per the design-system icon-size rule,
 * and the panel uses a calm `p-8` so it never over-pads.
 *
 * @example
 * ```tsx
 * // Minimal — neutral, no action.
 * <EmptyState title="Nothing yet" body="Activity will show up here as work happens." />
 *
 * // With a metaphor glyph and a primary action.
 * <EmptyState
 *   icon={Folder}
 *   title="No projects yet"
 *   body="Projects are bounded efforts with a clear finish line."
 *   cta={{ label: 'Create your first project', onClick: () => setCreateOpen(true) }}
 * />
 *
 * // Celebratory tone.
 * <EmptyState tone="positive" icon={Inbox} title="Inbox zero" body="Nothing needs you right now." />
 * ```
 */
import * as React from 'react';

import { Inbox } from '../../icons';
import { cn } from '../../lib/utils';
import { Button } from '../../primitives/button';

/** The supporting tone for an {@link EmptyState}'s glyph disc. */
export type EmptyStateTone = 'neutral' | 'positive' | 'accent';

/** A structured primary call-to-action for an {@link EmptyState}. */
export interface EmptyStateCta {
  /** The button label (e.g. "Create your first project"). */
  readonly label: string;
  /** Invoked when the action is activated. */
  readonly onClick: () => void;
}

/** Props for {@link EmptyState}. */
export interface EmptyStateProps {
  /**
   * The leading glyph (a `@docket/ui/icons` MUI component) shown in the toned disc. Optional —
   * defaults to a neutral `Inbox` glyph so an omitted icon still reads as an intentional surface.
   */
  readonly icon?: React.ComponentType<{ className?: string }>;
  /** The empty-state headline. */
  readonly title: string;
  /** The one-line supporting copy below the title. */
  readonly body: string;
  /**
   * Tints the glyph disc to give an empty state per-feature character while keeping the layout
   * identical. Defaults to `neutral`.
   */
  readonly tone?: EmptyStateTone;
  /**
   * A single primary action rendered as a filled {@link Button}. The common "create your first …"
   * case; for richer footers (a secondary link, two buttons) pass {@link EmptyStateProps.action}.
   */
  readonly cta?: EmptyStateCta;
  /**
   * A fully custom action slot rendered below the copy. Use for anything beyond a single primary
   * button; when both are given, `cta` renders first, then `action`.
   */
  readonly action?: React.ReactNode;
  /** Extra class names merged onto the outer container (e.g. `border-none` when already framed). */
  readonly className?: string;
}

/** The disc background + glyph color token for each {@link EmptyStateTone}. */
const TONE_DISC_CLASS: Record<EmptyStateTone, string> = {
  neutral: 'bg-surface-container-high text-on-surface-variant',
  positive: 'bg-state-completed/12 text-state-completed',
  accent: 'bg-primary/12 text-primary',
};

/**
 * A calm, centered empty state: a toned glyph disc, a title, supporting copy, and an optional
 * primary action.
 *
 * @remarks
 * Renders inside a dashed-border panel so it reads as an intentional empty surface rather than a
 * loading or broken state; pass `className="border-none"` when it already sits inside a framed
 * container. The icon is decorative (`aria-hidden`), so the title + body carry the accessible
 * meaning.
 */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  body,
  tone = 'neutral',
  cta,
  action,
  className,
}: EmptyStateProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'border-outline-variant flex flex-col items-center gap-3 rounded-xl border border-dashed p-8 text-center',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex size-12 items-center justify-center rounded-full [&>svg]:size-6',
          TONE_DISC_CLASS[tone],
        )}
      >
        <Icon />
      </span>
      <p className="text-on-surface text-sm font-medium">{title}</p>
      <p className="text-on-surface-variant max-w-xs text-sm leading-relaxed">{body}</p>
      {cta ? (
        <Button size="sm" onClick={cta.onClick}>
          {cta.label}
        </Button>
      ) : null}
      {action}
    </div>
  );
}
