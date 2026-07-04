/**
 * `@docket/api` — transactional email templates for account end-of-life and security events.
 *
 * @remarks
 * Pure builders returning `{ subject, html, text }` for the mailer port (no I/O). Each event
 * — deletion scheduled, deletion canceled, export ready, recovery codes regenerated — gets a
 * plain, skimmable message with both an HTML and a text part, matching the daily-digest mailer
 * shape.
 */

/** One rendered email: subject plus HTML and plain-text bodies. */
export interface AccountEmail {
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

/** Format an ISO instant as a human date (UTC, e.g. "June 29, 2026"). */
function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(iso));
}

/**
 * Assemble an account email from body paragraphs, wrapping them in the shared greeting +
 * sign-off envelope (so the framing lives in one place across all account emails).
 *
 * @param name - The recipient's name (or null for a generic greeting).
 * @param subject - The email subject line.
 * @param paragraphs - The differing body paragraphs, each in text + html form.
 */
function buildEmail(
  name: string | null,
  subject: string,
  paragraphs: readonly EmailParagraph[],
): AccountEmail {
  const text = [greeting(name), '', ...paragraphs.map((p) => p.text), '', '— Docket'].join('\n');
  const htmlBody = [greeting(name), ...paragraphs.map((p) => p.html), '— Docket']
    .map((p) => `<p>${p}</p>`)
    .join('\n');
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#111">\n${htmlBody}\n</div>`;
  return { subject, html, text };
}

/**
 * The "your account is scheduled for deletion" email (sent when deletion is scheduled).
 *
 * @param params - The recipient's name and the grace-window close instant.
 */
export function deletionScheduledEmail(params: {
  name: string | null;
  deleteAfterAt: string;
}): AccountEmail {
  const when = formatDate(params.deleteAfterAt);
  return buildEmail(params.name, `Your Docket account is scheduled for deletion on ${when}`, [
    {
      text: `Your Docket account is scheduled to be permanently deleted on ${when}.`,
      html: `Your Docket account is scheduled to be <strong>permanently deleted on ${when}</strong>.`,
    },
    {
      text: 'Changed your mind? Sign in any time before then and cancel the deletion from Settings → Danger zone — everything will be restored.',
      html: 'Changed your mind? Sign in any time before then and cancel the deletion from <strong>Settings → Danger zone</strong> — everything will be restored.',
    },
    {
      text: 'After that date, your account and personal data are permanently removed and cannot be recovered.',
      html: 'After that date, your account and personal data are permanently removed and cannot be recovered.',
    },
  ]);
}

/** The "your account deletion was canceled" email (sent when deletion is canceled). */
export function deletionCanceledEmail(params: { name: string | null }): AccountEmail {
  return buildEmail(params.name, 'Your Docket account deletion was canceled', [
    {
      text: 'Your scheduled account deletion has been canceled — your Docket account is fully active again.',
      html: 'Your scheduled account deletion has been <strong>canceled</strong> — your Docket account is fully active again.',
    },
    {
      text: "If you didn't make this change, please review your account security.",
      html: "If you didn't make this change, please review your account security.",
    },
  ]);
}

/**
 * The "your data export is ready" email (sent when an export job completes).
 *
 * @param params - The recipient's name, the download URL, and its expiry instant.
 */
export function exportReadyEmail(params: {
  name: string | null;
  downloadUrl: string;
  expiresAt: string;
}): AccountEmail {
  const when = formatDate(params.expiresAt);
  return buildEmail(params.name, 'Your Docket data export is ready', [
    {
      text: `Your Docket data export is ready to download:\n${params.downloadUrl}`,
      html: `Your Docket data export is ready: <a href="${params.downloadUrl}">Download your data</a>.`,
    },
    { text: `This link expires on ${when}.`, html: `This link expires on ${when}.` },
  ]);
}

/**
 * The "your recovery codes were regenerated" security notice.
 *
 * @remarks
 * Regenerating invalidates the previous set, so this fires unconditionally whenever the
 * (step-up-gated) `POST /me/recovery-codes` succeeds — a lost/stolen session that manages to
 * step up is still visible to the real owner via this notice.
 */
export function recoveryCodesRegeneratedEmail(params: { name: string | null }): AccountEmail {
  return buildEmail(params.name, 'Your Docket recovery codes were regenerated', [
    {
      text: 'Your Docket account recovery codes were just regenerated. Your previous codes no longer work.',
      html: 'Your Docket account recovery codes were just regenerated. Your <strong>previous codes no longer work</strong>.',
    },
    {
      text: "If this wasn't you, sign in and check Settings → Security — regenerating again invalidates whatever set an attacker might hold.",
      html: "If this wasn't you, sign in and check <strong>Settings → Security</strong> — regenerating again invalidates whatever set an attacker might hold.",
    },
  ]);
}
