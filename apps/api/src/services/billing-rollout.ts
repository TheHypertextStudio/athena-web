/** Better Auth identity fields used to admit a billing canary. */
export interface BillingRolloutIdentity {
  /** Email address established by Better Auth. */
  readonly email: string;
  /** Whether Better Auth has verified ownership of the email address. */
  readonly emailVerified: boolean;
}

/** Read a comma-separated canary list into normalized email addresses. */
function canaryEmails(raw: string | undefined): readonly string[] {
  return (
    raw
      ?.split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean) ?? []
  );
}

/**
 * Decide whether one Better Auth account may start a customer billing operation.
 *
 * @param publicEnabled - The public Checkout rollout flag.
 * @param rawCanaryEmails - Configured Better Auth account emails for the internal canary.
 * @param identity - The current server-resolved Better Auth user.
 * @returns `true` for public launch or a verified account in the canary list.
 */
export function customerBillingEnabled(
  publicEnabled: unknown,
  rawCanaryEmails: string | undefined,
  identity: BillingRolloutIdentity | null | undefined,
): boolean {
  if (publicEnabled === true || publicEnabled === 'true') return true;
  if (!identity?.emailVerified) return false;
  return canaryEmails(rawCanaryEmails).includes(identity.email.trim().toLowerCase());
}
