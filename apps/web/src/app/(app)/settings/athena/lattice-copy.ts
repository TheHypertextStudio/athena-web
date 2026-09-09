/**
 * `settings/athena` — application-owned copy for every Lattice state.
 *
 * @remarks
 * The API returns stable codes, never a sentence; this module is where a code becomes words. The
 * card intentionally carries no separate "here's why" messaging beyond what's below — a state is
 * shown by what the UI itself looks like (a device row's own status word, which buttons are
 * present), not narrated in a second sentence next to it.
 */

/** Why a whole deployment cannot offer Lattice. */
export type LatticeDeploymentReason = 'not_configured';

/** Copy for each deployment-level reason. */
export const LATTICE_DEPLOYMENT_COPY: Readonly<Record<LatticeDeploymentReason, string>> = {
  not_configured: 'Lattice is not set up for this Docket deployment yet.',
};

/** What each device state means, in one word a person can scan. */
export const LATTICE_DEVICE_STATUS_COPY: Readonly<
  Record<'unpaired' | 'reachable' | 'offline' | 'revoked', string>
> = {
  reachable: 'Ready',
  offline: 'Asleep',
  unpaired: 'Not set up',
  revoked: 'Disabled',
};

/** The outcome flag the OAuth callback puts on the return URL. */
export type LatticeAuthorizationOutcome = 'connected' | 'declined' | 'error' | 'scopes';

/** Every reason a Lattice write can be refused, mirroring `LatticeUnavailableReason` in `@docket/integrations`. */
export type LatticeUnavailableReason =
  | 'not_connected'
  | 'no_device_selected'
  | 'device_offline'
  | 'device_unpaired'
  | 'device_revoked'
  | 'device_missing'
  | 'authorization_expired'
  | 'insufficient_scopes'
  | 'gateway_unreachable'
  | 'gateway_error';

/**
 * What to do when a click (switch computers, turn on) gets refused for a stable reason.
 *
 * @remarks
 * Acute feedback for a write that just failed, not the persistent standing notice this section
 * deliberately does not carry — it renders once, next to the control that was clicked, through the
 * same slot as any other write error.
 */
export const LATTICE_UNAVAILABLE_REASON_MESSAGE: Readonly<
  Record<LatticeUnavailableReason, string>
> = {
  not_connected: 'Connect Lattice to use local models for Athena.',
  no_device_selected: 'Choose a computer before turning this on.',
  device_offline:
    'That computer is not reachable. Wake it and make sure Lattice is running, then try again.',
  device_unpaired:
    'That computer has not finished pairing. Finish setup on the computer, then try again.',
  device_revoked: 'That computer was disabled in your Lovelace account. Choose a different one.',
  device_missing:
    'That computer is no longer on your Lovelace account. Refresh the list and try again.',
  authorization_expired: 'Reconnect Lovelace to restore access.',
  insufficient_scopes: 'Reconnect Lovelace and approve all the requested permissions.',
  gateway_unreachable: 'Could not reach Lovelace. Check your connection and try again.',
  gateway_error: 'Lovelace could not complete that request. Try again in a moment.',
};

/**
 * Lovelace's own setup docs for the local Lattice daemon.
 *
 * @remarks
 * Docket doesn't own or mirror the install command itself — Lovelace's marketing site and its
 * developer docs already disagree on the exact one-liner (`d.uselovelace.com/install` vs.
 * `uselovelace.com/lattice/install.sh`, checked 2026-09-06), so a copy embedded here would be one
 * more place for that to drift stale. Linking to the page Lovelace keeps current is the fix, not
 * picking a winner.
 */
export const LATTICE_SETUP_URL = 'https://developers.uselovelace.com/lattice';

/**
 * Copy shown only after a supported browser's native FedCM ceremony did not finish.
 *
 * @remarks
 * This state is reached by a dismissed dialog and by a dialog that failed on its own, and the
 * person cannot tell those apart. So the copy names the way forward and says what the next click
 * does, rather than narrating a cause it cannot know.
 */
export const LATTICE_FEDCM_FALLBACK_COPY = {
  title: 'Finish connecting on Lovelace',
  body: 'Lovelace opens in this tab and brings you back here once you approve the connection.',
  action: 'Continue on Lovelace',
} as const;
