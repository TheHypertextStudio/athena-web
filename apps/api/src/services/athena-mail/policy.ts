/** Mail-channel authority requires enrollment and receiving-server authentication. */
export function ownerMailEligible(
  from: string,
  enrolled: string,
  authentication?: { spf: string; dkim: string; dmarc: string },
): boolean {
  return (
    from.toLowerCase() === enrolled.toLowerCase() &&
    authentication?.dmarc === 'pass' &&
    authentication.dkim === 'pass'
  );
}
/** Identify robot mail before admitting paid assistant execution. */
export function automaticMail(headers: Readonly<Record<string, string>>): boolean {
  if (headers['auto-submitted'] && headers['auto-submitted'] !== 'no') return true;
  if (headers['list-id']) return true;
  return /delivery-status/i.test(headers['content-type'] ?? '');
}
/** Resend guarantees idempotent retries only inside its 24-hour key lifetime. */
export function outboundRetryAllowed(firstAttempt: Date, now: Date): boolean {
  return now.getTime() - firstAttempt.getTime() < 23.5 * 3600_000;
}
/** Bound paid email work and model context without a configuration surface. */
export const OWNER_MAIL_HOURLY_LIMIT = 20;
/** Maximum body characters Athena processes per email. */
export const OWNER_MAIL_BODY_LIMIT = 50_000;
/** RFC thread references are untrusted and bounded before lookup. */
export function mailReferences(headers: Readonly<Record<string, string>>): string[] {
  return (
    [headers['in-reply-to'] ?? '', headers['references'] ?? '']
      .join(' ')
      .slice(-8000)
      .match(/<[^>]{1,500}>/g) ?? []
  ).slice(-20);
}
