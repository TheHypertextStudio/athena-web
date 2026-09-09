/** Better Auth identity fields used to admit a phone-verification canary. */
export interface PhoneVerificationRolloutIdentity {
  /** Email address established by Better Auth. */
  readonly email: string;
  /** Whether Better Auth verified ownership of the email address. */
  readonly emailVerified: boolean;
}

function canaryEmails(raw: string | undefined): readonly string[] {
  return (
    raw
      ?.split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean) ?? []
  );
}

/** Decide whether one account may start or resend a phone verification. */
export function phoneVerificationEnabled(
  publicEnabled: unknown,
  rawCanaryEmails: string | undefined,
  identity: PhoneVerificationRolloutIdentity | null | undefined,
): boolean {
  if (publicEnabled === true || publicEnabled === 'true') return true;
  if (!identity?.emailVerified) return false;
  return canaryEmails(rawCanaryEmails).includes(identity.email.trim().toLowerCase());
}
