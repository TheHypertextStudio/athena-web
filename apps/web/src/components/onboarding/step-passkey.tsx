'use client';

/**
 * `onboarding/step-passkey` — the optional "add a passkey" beat for social-sign-up users.
 *
 * @remarks
 * A user who signs up with Google lands with no passkey of their own — they can sign in again only
 * through the social provider, and they can't complete an in-page passkey step-up for sensitive
 * actions (see `settings/use-reauth`). This skippable step nudges them to enrol a device passkey
 * right after setup so they get a phishing-resistant, provider-independent credential. It is
 * presentational only: the enrol / skip actions live in the wizard footer (driven by the
 * orchestrating page), matching how every other step's primary action is wired. Users who signed
 * up with a passkey never see this step — the orchestrator only appends it when the account has
 * zero passkeys.
 */
import { Cable, Shield, Sparkles } from '@docket/ui/icons';
import type { LucideIcon } from '@docket/ui/icons';
import type { JSX } from 'react';

/** One reason to add a passkey now. */
interface Highlight {
  /** The leading glyph. */
  icon: LucideIcon;
  /** The highlight headline. */
  title: string;
  /** A plain-language sentence describing the benefit. */
  body: string;
}

/** Why a social-sign-up user benefits from adding a passkey, in plain language. */
const HIGHLIGHTS: readonly Highlight[] = [
  {
    icon: Sparkles,
    title: 'Sign in in a second',
    body: 'Use Face ID, Touch ID, or a security key — no password, no provider redirect.',
  },
  {
    icon: Shield,
    title: 'Harder to phish',
    body: 'A passkey is tied to this site, so it can’t be handed to a lookalike page by mistake.',
  },
  {
    icon: Cable,
    title: 'Not tied to one login',
    body: 'Get back in even if your Google account is ever unavailable — your key is your own.',
  },
];

/** The optional passkey-enrollment screen for users who signed up via a social provider. */
export function StepPasskey(): JSX.Element {
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
            <span className="text-on-surface-variant text-body leading-relaxed">
              {highlight.body}
            </span>
          </div>
        </div>
      ))}
      <p className="text-on-surface-variant text-body mt-2">
        Your device will ask you to confirm. You can always add a passkey later in Settings →
        Security.
      </p>
    </div>
  );
}
