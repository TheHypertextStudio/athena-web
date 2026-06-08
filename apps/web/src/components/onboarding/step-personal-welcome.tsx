'use client';

/**
 * `onboarding/step-personal-welcome` — the individual fork's confident welcome beat.
 *
 * @remarks
 * No form. The person is setting up their own command center, so this screen sells what that
 * is in plain language — a home for everything, a place to connect tools they already use,
 * and a launchpad for shared workspaces when they need one — rather than asking for an org
 * name or vocabulary (the personal space is created silently on finish).
 */
import { Home, LayoutGrid, Plus } from '@docket/ui/icons';
import type { LucideIcon } from '@docket/ui/icons';
import type { JSX } from 'react';

/** One "what your Hub does" highlight. */
interface Highlight {
  /** The leading glyph. */
  icon: LucideIcon;
  /** The highlight headline. */
  title: string;
  /** A plain-language sentence describing the capability. */
  body: string;
}

/** The three things the personal Hub gives an individual, in plain language. */
const HIGHLIGHTS: readonly Highlight[] = [
  {
    icon: Home,
    title: 'Your home for everything',
    body: 'One calm place to see what matters today and keep your own work moving.',
  },
  {
    icon: LayoutGrid,
    title: 'Connect the tools you use',
    body: 'Bring the apps you already work in together, so nothing slips through the cracks.',
  },
  {
    icon: Plus,
    title: 'Spin up shared spaces anytime',
    body: 'Start a workspace for a team or project whenever you need to bring people in.',
  },
];

/** Props for {@link StepPersonalWelcome}. */
export interface StepPersonalWelcomeProps {
  /** The signed-in person's first name, when known, for a warmer greeting. */
  firstName?: string;
}

/**
 * The individual fork's welcome screen — sets the tone before the personal space is created.
 */
export function StepPersonalWelcome({ firstName }: StepPersonalWelcomeProps): JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      {HIGHLIGHTS.map((highlight) => (
        <div
          key={highlight.title}
          className="border-outline-variant bg-surface-container-low flex items-start gap-4 rounded-xl border p-5"
        >
          <span
            aria-hidden
            className="border-primary/30 bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-lg border"
          >
            <highlight.icon className="size-5" />
          </span>
          <div className="flex flex-col gap-1">
            <span className="text-on-surface text-base leading-tight font-semibold">
              {highlight.title}
            </span>
            <span className="text-on-surface-variant text-sm leading-relaxed">
              {highlight.body}
            </span>
          </div>
        </div>
      ))}

      {firstName ? (
        <p className="text-on-surface-variant mt-2 text-sm">
          Ready when you are, {firstName}
          {' — '}we&apos;ll set up your space in a moment.
        </p>
      ) : null}
    </div>
  );
}
