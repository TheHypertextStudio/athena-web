import type { ProblemRecovery } from '@docket/types';

/** A safe generic recovery action rendered on a public Docket problem page. */
export interface PublicProblemRecoveryAction {
  /** Same-origin destination that never carries occurrence-specific error data. */
  readonly href: string;
  /** The concise action label displayed in the public page CTA. */
  readonly label: string;
  /** General recovery guidance safe to expose without an authenticated session. */
  readonly instruction: string;
}

/**
 * The public recovery action for every stable problem recovery mode.
 *
 * @remarks
 * These actions deliberately avoid resource, account, and request identifiers. A return to the
 * product is required to finish a context-specific action; protected destinations open the
 * authentication interlock when the person is not signed in.
 */
export const PUBLIC_PROBLEM_RECOVERY: Record<ProblemRecovery, PublicProblemRecoveryAction> = {
  sign_in: {
    href: '/sign-in',
    label: 'Sign in',
    instruction: 'Sign in, then return to Docket and retry the action you started.',
  },
  reauthenticate: {
    href: '/sign-in',
    label: 'Sign in again',
    instruction:
      'Sign in again, then return to Docket and verify your identity before retrying the sensitive action.',
  },
  retry: {
    href: '/today',
    label: 'Return to Docket',
    instruction: 'Return to Docket and retry when you are ready.',
  },
  review: {
    href: '/today',
    label: 'Return to Docket',
    instruction: 'Return to Docket to review the required information, access, or ownership.',
  },
  billing: {
    href: '/pricing',
    label: 'View plans',
    instruction: 'Review your plan or billing information, then return to Docket to continue.',
  },
  reconnect: {
    href: '/sign-in',
    label: 'Sign in to reconnect',
    instruction:
      'Sign in, then restart the connection from the client that made this request and approve the additional access it requests.',
  },
  return: {
    href: '/today',
    label: 'Return to Docket',
    instruction: 'Return to Docket to choose another available action.',
  },
};
