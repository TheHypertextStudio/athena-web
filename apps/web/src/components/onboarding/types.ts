/**
 * `onboarding/types` — shared vocabulary for the first-run onboarding wizard.
 *
 * @remarks
 * The wizard is a small state machine: the user picks an {@link OnboardingIntent} on the
 * first screen, which forks the remaining steps. The individual ("just me") fork sets up a
 * personal space; the team / nonprofit fork walks through naming and vocabulary. These types
 * are shared by the orchestrating page and the per-step screen components so the two stay in
 * lockstep without leaking step-component internals into one another.
 */
import type { OrgCreate } from '@docket/types';

/** The fork a new user picks on the first onboarding screen. */
export type OnboardingIntent = Exclude<OrgCreate['intent'], undefined>;

/** A selectable vocabulary preset for a team / nonprofit org. */
export type Vocabulary = OrgCreate['vocabulary'];

/**
 * The distinct screens the wizard can show.
 *
 * @remarks
 * `intent` is always first. After that the path forks: the `personal` fork shows
 * `personal-welcome` then the shared `connect` beat; the team / nonprofit fork shows `name`,
 * `vocabulary`, then `connect`. A final `passkey` beat is appended for either fork only when the
 * account has no passkey yet (a social sign-up), nudging the user to enrol one. The orchestrator
 * computes the ordered step list from the chosen intent (and that condition) so progress and
 * back/next navigation are derived, never hand-maintained.
 */
export type OnboardingStep =
  | 'intent'
  | 'personal-welcome'
  | 'name'
  | 'vocabulary'
  | 'connect'
  | 'passkey';
