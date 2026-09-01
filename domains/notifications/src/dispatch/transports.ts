import type { Mailer } from '@docket/mail';
import type { PushSender, SmsSender } from '@docket/integrations';

/**
 * The delivery transports every adapter falls back to when a caller doesn't inject one directly
 * (`DeliverEmailNotificationInput.mailer` etc.) — module-level, configured once at process
 * startup.
 *
 * @remarks
 * This package has no dependency injection container of its own, and callers span more than one
 * app-level entrypoint in the same process (`apps/api`'s routes AND `packages/auth`'s Better Auth
 * hooks both dispatch notifications) — so rather than each caller threading a mailer/SMS/push
 * sender through every dispatch call, the host process configures the real transports exactly
 * once via {@link configureNotificationTransports} (see `apps/api/src/container.ts`), and every
 * adapter in this package reads them from here. Reading before configuring is a real bug (a
 * dispatch was attempted before the host process finished wiring itself up), so the accessors
 * throw a clear error rather than silently no-op or reach back into a specific app's container.
 */
let transports: NotificationTransports | null = null;

/**
 * The real delivery transports a host process supplies once at startup, as lazy accessors — not
 * eagerly-resolved values — so registering these doesn't force-construct a transport (e.g. an SMS
 * sender in an environment that never configured one) before anything actually needs it.
 */
export interface NotificationTransports {
  readonly mailer: () => Mailer;
  readonly sms: () => SmsSender;
  readonly push: () => PushSender;
}

/** Register the real delivery transports. Call once, during process startup. */
export function configureNotificationTransports(next: NotificationTransports): void {
  transports = next;
}

/** The configured mailer, or a clear error if {@link configureNotificationTransports} never ran. */
export function defaultMailer(): Mailer {
  if (!transports) throw new Error('Notification transports were never configured (no mailer)');
  return transports.mailer();
}

/** The configured SMS sender, or a clear error if transports were never configured. */
export function defaultSmsSender(): SmsSender {
  if (!transports) throw new Error('Notification transports were never configured (no SMS sender)');
  return transports.sms();
}

/** The configured push sender, or a clear error if transports were never configured. */
export function defaultPushSender(): PushSender {
  if (!transports)
    throw new Error('Notification transports were never configured (no push sender)');
  return transports.push();
}
