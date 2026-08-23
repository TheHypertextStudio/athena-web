'use client';

/**
 * The inline chip a mention renders as.
 *
 * @remarks
 * One component for every surface that shows a reference — the editor node view, the read-only
 * renderer, the Resources tab, the hovercard header — so a mention cannot look like two different
 * things depending on where you meet it.
 *
 * It is a real `<a href>`, not a span with a click handler. That is what gives middle-click,
 * ⌘-click, "copy link address", and correct semantics for a screen reader, none of which are worth
 * reimplementing badly.
 *
 * The tonal treatment is deliberately neutral. `surface-container-high` sits one to two steps
 * above the prose it is embedded in, which reads as a chip without needing a border — while the
 * *coloured* tonal roles stay reserved for meaning (health, priority, state, org accent) as the
 * design system requires. A mention is structural, not semantic.
 */
import { cn } from '@docket/ui/lib/utils';
import type { MentionRef } from '@docket/types';
import type { ReactNode } from 'react';

import Link from '@/components/docket-link';

/** Props for {@link MentionChip}. */
export interface MentionChipProps {
  /** What the chip points at. */
  readonly ref: MentionRef;
  /** Text to render, already resolved to the freshest title available. */
  readonly label: string;
  /** Where clicking goes. */
  readonly href: string;
  /** Leading glyph — an entity kind mark, a provider mark, or a favicon. */
  readonly icon?: ReactNode;
  /** Whether the target leaves the app, which decides the tab behavior. */
  readonly external?: boolean;
  /** True inside an editor, where a plain click must place the caret rather than navigate. */
  readonly editable?: boolean;
  /** True when the ProseMirror node is selected, which is also the keyboard hovercard path. */
  readonly selected?: boolean;
  /** True when the reference could not be resolved, or access to it has been lost. */
  readonly unresolved?: boolean;
  readonly className?: string;
  readonly onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}

/**
 * Render one inline mention.
 *
 * @returns The chip anchor.
 */
export default function MentionChip({
  ref: mentionRef,
  label,
  href,
  icon,
  external = false,
  editable = false,
  selected = false,
  unresolved = false,
  className,
  onClick,
}: MentionChipProps): React.JSX.Element {
  return (
    <Link
      href={href}
      // Inside an editor the chip must not be a tab stop, or Tab would walk out of the document
      // instead of indenting. The hovercard stays keyboard-reachable there by arrowing onto the
      // node, which selects it.
      tabIndex={editable ? -1 : 0}
      data-mention-id={mentionRef.kind === 'entity' ? mentionRef.entityId : mentionRef.url}
      data-mention-kind={mentionRef.kind}
      // The full title goes here rather than in `title`, which would summon a native tooltip that
      // fights the hovercard and cannot be styled.
      aria-label={label}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      {...(onClick ? { onClick } : {})}
      className={cn(
        // 22ch was clipping most titles down to a fragment; 40ch shows a title in full in the
        // common case and still caps how much of a line of prose one mention can take over.
        'inline-flex max-w-[40ch] items-baseline gap-1 truncate align-baseline whitespace-nowrap',
        // `rounded-md` matches `CONTROL_RADIUS` (packages/ui/src/primitives/control.tsx) — the
        // same corner radius every other control in the system uses, rather than a one-off value.
        '-mx-px -my-px rounded-md px-1 py-px',
        'text-[0.95em] font-medium no-underline',
        'transition-colors duration-(--dur-fast) ease-(--ease-out)',
        unresolved
          ? 'bg-surface-container text-on-surface-variant'
          : 'bg-surface-container-high text-on-surface hover:bg-surface-container-highest',
        // A selection ring, not a focus ring: this is the node being selected in the document,
        // which is a different state from the element having keyboard focus.
        selected && 'ring-primary/40 bg-surface-container-highest ring-1',
        className,
      )}
    >
      {icon ? (
        // `self-center` overrides the anchor's own `items-baseline`: the icon has no text
        // baseline of its own, so centering it on the row's cross-axis (set by the label's
        // line height) reads correctly regardless of font size, instead of guessing a fixed
        // translate offset that only happened to work at one size.
        <span aria-hidden className="inline-flex shrink-0 self-center">
          {icon}
        </span>
      ) : null}
      <span className="truncate">{label}</span>
    </Link>
  );
}
