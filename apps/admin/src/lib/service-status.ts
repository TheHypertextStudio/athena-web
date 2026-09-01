import type { BadgeProps } from '@docket/ui/primitives';

import type { AdminServiceStatus, AdminStatus } from './types';

/** The outcomes a service check can report. */
export type ProbeOutcome = AdminServiceStatus['outcome'];

/** Why a check did not succeed. */
export type ProbeReason = NonNullable<AdminServiceStatus['reason']>;

/**
 * What each outcome is called on screen.
 *
 * @remarks
 * Application-owned, like every other string this console shows. The API returns a code; the words
 * live here, so wording can change without a deploy of the API and a provider can never supply any
 * of them.
 */
const OUTCOME_LABEL: Readonly<Record<ProbeOutcome, string>> = {
  up: 'Operational',
  degraded: 'Degraded',
  down: 'Down',
  disabled: 'Off',
  unknown: 'Not measured',
};

/**
 * What each failure reason means in plain words.
 *
 * @remarks
 * `no_recent_activity` deliberately does not read as a failure, because it is not one — nothing
 * asked the provider anything, so nothing was learned.
 */
const REASON_LABEL: Readonly<Record<ProbeReason, string>> = {
  unreachable: 'No response',
  bad_status: 'Answered with an error',
  recent_failures: 'Recent requests are failing',
  no_recent_activity: 'No recent requests to measure',
  not_configured: 'Not configured for this deployment',
};

/**
 * The {@link Badge} variant each outcome takes.
 *
 * @remarks
 * Colour is spent only where something is wrong. `up` is deliberately not green: on a board whose
 * normal state is every service healthy, painting all of them green makes the one that is not
 * harder to find, not easier — so everything that is fine, off, or unmeasured reads as the same
 * quiet secondary pill and only a fault carries a hue.
 */
const OUTCOME_BADGE_VARIANTS: Readonly<Record<ProbeOutcome, NonNullable<BadgeProps['variant']>>> = {
  up: 'secondary',
  // The accent fill, matching how the attention band already marks work that needs a person but
  // has not failed. A degraded service is reachable and wrong, which is neither `up` nor `down`.
  degraded: 'default',
  down: 'destructive',
  disabled: 'secondary',
  unknown: 'secondary',
};

/** Name one outcome. */
export function outcomeLabel(outcome: ProbeOutcome): string {
  return OUTCOME_LABEL[outcome];
}

/** Explain one failure reason. */
export function reasonLabel(reason: ProbeReason): string {
  return REASON_LABEL[reason];
}

/** The badge variant one outcome carries. */
export function outcomeBadgeVariant(outcome: ProbeOutcome): NonNullable<BadgeProps['variant']> {
  return OUTCOME_BADGE_VARIANTS[outcome];
}

/** Whether an outcome is something an operator should act on. */
function isFault(outcome: ProbeOutcome): boolean {
  return outcome === 'down' || outcome === 'degraded';
}

/**
 * Render an uptime ratio.
 *
 * @remarks
 * Two decimal places, because the difference between 99.9% and 99.99% is the difference between
 * nine hours of downtime a year and fifty minutes, and rounding to a whole number hides it.
 *
 * An unmeasured window reads as a dash, never as 0% or 100%.
 *
 * @param uptime - The ratio, or `null` when the window held no measurable check.
 * @returns the ratio as a percentage, or `—`.
 */
export function formatUptime(uptime: number | null): string {
  if (uptime === null) return '—';
  return `${(uptime * 100).toFixed(2)}%`;
}

/**
 * Name an uptime window.
 *
 * @param hours - The window length.
 * @returns a short label such as `24h` or `30d`.
 */
export function windowLabel(hours: number): string {
  return hours < 48 ? `${String(hours)}h` : `${String(Math.round(hours / 24))}d`;
}

/**
 * The services that need an operator right now.
 *
 * @param status - The board, or `undefined` before it resolves.
 * @returns every service reporting a fault.
 */
export function faultingServices(status: AdminStatus | undefined): readonly AdminServiceStatus[] {
  return (status?.services ?? []).filter((service) => isFault(service.outcome));
}
