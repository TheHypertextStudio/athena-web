/**
 * `settings/athena` — application-owned copy for every Lattice state.
 *
 * @remarks
 * The API returns stable codes and never a sentence. This module is where those codes become
 * words, which is the whole point of the split: a person reading "your MacBook is asleep" should
 * never be reading a gateway's error string, and the gateway should be free to reword its
 * diagnostics without changing what Docket says.
 *
 * Each entry pairs the plain statement with the action that resolves it. A reason with no action
 * is a reason that should not have been surfaced.
 */

/** Every actionable reason the API can report for a Lattice connection. */
export type LatticeReason =
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

/** What a person is told, and what they can do about it. */
export interface LatticeReasonCopy {
  /** What is true right now, in one sentence. */
  readonly title: string;
  /** What to do about it. */
  readonly action: string;
}

/** Copy for each reason. Total map: a new reason is a compile error until it has words. */
export const LATTICE_REASON_COPY: Readonly<Record<LatticeReason, LatticeReasonCopy>> = {
  not_connected: {
    title: 'Your Lovelace account is not connected.',
    action: 'Connect Lovelace to run models on your own computer.',
  },
  no_device_selected: {
    title: 'No computer is chosen yet.',
    action: 'Pick which of your computers should run the models.',
  },
  device_offline: {
    title: 'That computer is not reachable right now.',
    action: 'Wake it and make sure Lattice is running on it, then try again.',
  },
  device_unpaired: {
    title: 'That computer has not finished pairing.',
    action: 'Finish setup on the computer itself, then refresh this list.',
  },
  device_revoked: {
    title: 'That computer was disabled in your Lovelace account.',
    action: 'Choose a different computer, or re-enable it in Lovelace.',
  },
  device_missing: {
    title: 'That computer is no longer on your Lovelace account.',
    action: 'Choose a different computer.',
  },
  authorization_expired: {
    title: 'Docket is no longer authorized to use your Lovelace account.',
    action: 'Connect Lovelace again to restore access.',
  },
  insufficient_scopes: {
    title: 'The Lovelace approval did not include everything Athena needs.',
    action: 'Connect again and approve all of the requested permissions.',
  },
  gateway_unreachable: {
    title: 'Docket could not reach Lovelace.',
    action: 'Check your connection and try again in a moment.',
  },
  gateway_error: {
    title: 'Lovelace could not complete that request.',
    action: 'Try again in a moment.',
  },
};

/** Why a whole deployment cannot offer Lattice. */
export type LatticeDeploymentReason = 'not_configured';

/** Copy for each deployment-level reason. */
export const LATTICE_DEPLOYMENT_COPY: Readonly<Record<LatticeDeploymentReason, string>> = {
  not_configured:
    'Running models on your own computer is not set up for this Docket deployment yet.',
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

/** Copy for the outcome flag the OAuth callback puts on the return URL. */
export const LATTICE_RETURN_COPY: Readonly<Record<string, string>> = {
  connected: 'Lovelace connected. Choose which computer should run the models.',
  declined: 'You declined the request, so nothing changed.',
  scopes: 'Some permissions were not approved, so Athena cannot run models on your computer yet.',
  error: 'That connection attempt did not finish. You can try again.',
};
