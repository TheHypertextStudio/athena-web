/**
 * `@docket/auth` — transactional email templates for authentication events.
 *
 * @remarks
 * Pure builders returning `{ subject, html, text }` for the {@link Mailer} port (no I/O),
 * matching the shape `apps/api/src/account/emails.ts` uses for account-lifecycle mail. These
 * are the auth-flow messages Better Auth (or the signup-challenge plugin) triggers from inside
 * the auth instance: the email-verification code, and — later — change-email confirmation and
 * security notices. Keeping them pure means each is unit-testable with no mailer or network.
 */

/** One rendered email: subject plus HTML and plain-text bodies. */
export interface AuthEmail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

/** One body paragraph in both representations (the HTML form may carry inline markup). */
interface EmailParagraph {
  readonly text: string;
  readonly html: string;
}

/** A friendly greeting line — falls back to a generic salutation when no name is known. */
function greeting(name: string | null): string {
  return name && name.trim().length > 0 ? `Hi ${name},` : 'Hi,';
}

/**
 * Assemble an auth email from body paragraphs, wrapping them in the shared greeting +
 * sign-off envelope (so the framing lives in one place across all auth emails).
 *
 * @param name - The recipient's name (or null for a generic greeting).
 * @param subject - The email subject line.
 * @param paragraphs - The differing body paragraphs, each in text + html form.
 */
function buildEmail(
  name: string | null,
  subject: string,
  paragraphs: readonly EmailParagraph[],
): AuthEmail {
  const text = [greeting(name), '', ...paragraphs.map((p) => p.text), '', '— Docket'].join('\n');
  const htmlBody = [greeting(name), ...paragraphs.map((p) => p.html), '— Docket']
    .map((p) => `<p>${p}</p>`)
    .join('\n');
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#111">\n${htmlBody}\n</div>`;
  return { subject, html, text };
}

/**
 * The email-verification code sent during passwordless sign-up (before any passkey is bound).
 *
 * @remarks
 * Sign-up proves inbox ownership before the WebAuthn ceremony runs: this carries the short code
 * the user types back to complete the `/sign-up/verify-code` challenge. The code is the only
 * secret — the message states its short lifetime and that an unexpected code can be ignored.
 *
 * @param params - The recipient's name (or null) and the one-time verification code.
 */
export function verificationCodeEmail(params: { name: string | null; code: string }): AuthEmail {
  return buildEmail(params.name, `Your Docket verification code: ${params.code}`, [
    {
      text: `Your Docket verification code is ${params.code}. Enter it to finish creating your account. It expires in 10 minutes.`,
      html: `Your Docket verification code is <strong>${params.code}</strong>. Enter it to finish creating your account. It expires in 10 minutes.`,
    },
    {
      text: "If you didn't try to sign up, you can safely ignore this email — no account is created until the code is used.",
      html: "If you didn't try to sign up, you can safely ignore this email — no account is created until the code is used.",
    },
  ]);
}

/**
 * The confirmation email sent to a user's CURRENT address when they request a change of email.
 *
 * @remarks
 * Sent to the OLD address, not the new one — confirming a change from the inbox you're leaving
 * is what stops an attacker who has merely guessed or observed the new address (e.g. a shared
 * device) from silently redirecting the account's identity. Clicking the link both verifies the
 * new address and completes the swap in one step (Better Auth's `/verify-email` endpoint).
 *
 * @param params - The recipient's name (or null), the requested new address, and the signed
 * confirmation `url` Better Auth generated (`sendChangeEmailConfirmation`).
 */
export function changeEmailConfirmationEmail(params: {
  name: string | null;
  newEmail: string;
  url: string;
}): AuthEmail {
  return buildEmail(params.name, 'Confirm your new Docket email address', [
    {
      text: `We received a request to change your Docket account's email to ${params.newEmail}. Confirm the change: ${params.url}`,
      html: `We received a request to change your Docket account's email to <strong>${params.newEmail}</strong>. <a href="${params.url}">Confirm the change</a>.`,
    },
    {
      text: "If you didn't request this, you can safely ignore this email — your address stays unchanged until the link above is used.",
      html: "If you didn't request this, you can safely ignore this email — your address stays unchanged until the link above is used.",
    },
  ]);
}
