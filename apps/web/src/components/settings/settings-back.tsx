/**
 * `settings` — the way back, wherever you are in Settings.
 *
 * @remarks
 * Settings has two places that go back and they must not diverge: the pane's "All settings" on a
 * narrow viewport, which returns to the section list, and a nested page's link to its parent
 * section. On a phone both are on screen at once, stacked, so any disagreement between them reads
 * as two different products.
 *
 * One of them is a `<button>` (it flips pane state) and the other is a `<Link>` (it navigates), so
 * they cannot be the same element — which is exactly why the *appearance* has to live somewhere
 * neither of them owns. {@link SETTINGS_BACK_CLASS} is that somewhere.
 *
 * The 44px minimum height is not padding taste: it is the pointer target the craft rubric requires
 * on mobile, and a back affordance is the control most likely to be reached for one-handed.
 */
import { cn } from '@docket/ui';
import { ChevronLeft } from '@docket/ui/icons';
import { focusRing } from '@docket/ui/primitives';
import NextLink from '@/components/docket-link';
import type { JSX } from 'react';

/**
 * The shared appearance of a Settings back affordance.
 *
 * @remarks
 * Exported as a class rather than wrapped in a component because the pane's back is a button and
 * this one is a link; a component that had to be both would take an `as` prop and earn nothing.
 */
export const SETTINGS_BACK_CLASS = cn(
  'text-on-surface-variant text-label-large hover:bg-surface-container-highest hover:text-on-surface',
  '-ml-2 inline-flex min-h-11 shrink-0 items-center gap-1 self-start rounded-md pr-3 pl-1 transition-colors',
  focusRing,
);

/** Props for {@link SettingsBackLink}. */
export interface SettingsBackLinkProps {
  /** Where it goes. */
  readonly href: string;
  /** What is there, named as the nav names it. */
  readonly label: string;
}

/**
 * A link back to the section a nested page sits under.
 *
 * @param props - The {@link SettingsBackLinkProps}.
 * @returns the rendered back link.
 */
export function SettingsBackLink({ href, label }: SettingsBackLinkProps): JSX.Element {
  return (
    <NextLink href={href} className={SETTINGS_BACK_CLASS}>
      <ChevronLeft aria-hidden="true" className="size-5 shrink-0" />
      {label}
    </NextLink>
  );
}
