import type { OrgSummary } from '@docket/types';
import {
  DENSITIES,
  type Density,
  type HomeNavKey,
  type WorkspaceNavKey,
} from '@docket/ui/components';
import DocketLink from '@/components/docket-link';
import type { ReactNode } from 'react';

import { sameOriginPath } from '@/lib/same-origin-path';

/** homeKeyFromPath derives a stable app shell storage or navigation key. */
export function homeKeyFromPath(pathname: string): HomeNavKey | undefined {
  if (/^\/today(?:\/|$)/.test(pathname)) return 'today';
  if (/^\/tasks(?:\/|$)/.test(pathname)) return 'tasks';
  if (/^\/calendar(?:\/|$)/.test(pathname)) return 'calendar';
  if (/^\/inbox(?:\/|$)/.test(pathname)) return 'inbox';
  if (/^\/stream(?:\/|$)/.test(pathname)) return 'stream';
  if (/^\/portfolio(?:\/|$)/.test(pathname)) return 'portfolio';
  return undefined;
}

/** orgIdFromPath derives app shell routing state from the current pathname. */
export function orgIdFromPath(pathname: string): string | null {
  const match = /^\/orgs\/([^/]+)(?:\/|$)/.exec(pathname);
  return match ? (match[1] ?? null) : null;
}

/**
 * The org-scoped sidebar destinations, in mvp-plan §7 order.
 *
 * Each {@link WorkspaceNavKey} maps 1:1 to its route segment under `/orgs/[orgId]/…`, so the
 * href builder and {@link workspaceKeyFromPath} stay in lockstep with the real route tree.
 *
 * Order matters twice over: it is the sidebar's row order, and it is the scan order
 * {@link workspaceKeyFromPath} uses. `tasks` sits directly after `triage`, mirroring the sidebar's
 * Workspace section, so `/orgs/:id/tasks` and `/orgs/:id/tasks/:taskId` both resolve to the same
 * highlighted row — opening one task never blanks the nav that led you to it.
 */
export const NAV_SEGMENTS: readonly WorkspaceNavKey[] = [
  'my-work',
  'triage',
  'tasks',
  'stream',
  'initiatives',
  'programs',
  'projects',
  'cycles',
  'teams',
  'people',
  'views',
  'graph',
  'settings',
];

/** workspaceKeyFromPath derives a stable app shell storage or navigation key. */
export function workspaceKeyFromPath(pathname: string): WorkspaceNavKey | undefined {
  for (const key of NAV_SEGMENTS) {
    if (new RegExp(`^/orgs/[^/]+/${key}(?:/|$)`).test(pathname)) return key;
  }
  return undefined;
}

const OBJECT_DETAIL_SEGMENTS = ['projects', 'initiatives', 'tasks', 'programs', 'cycles'] as const;

/** Return whether a pathname identifies one concrete work object rather than its overview. */
export function isObjectDetailPath(pathname: string): boolean {
  const segments = pathname.split('/').filter(Boolean);
  return (
    segments.length === 4 &&
    segments[0] === 'orgs' &&
    OBJECT_DETAIL_SEGMENTS.includes(segments[2] as (typeof OBJECT_DETAIL_SEGMENTS)[number]) &&
    Boolean(segments[3])
  );
}

/**
 * Build a Docket sign-in URL that returns to the given same-origin app path.
 *
 * @remarks
 * `returnPath` must already be a same-origin absolute path (from Next's routing hooks or
 * `window.location`), not an externally supplied URL — the sign-in page independently re-validates
 * it before use. `URLSearchParams` owns the query-string encoding so this never has to hand-roll
 * `encodeURIComponent` (and can't drift from how the sign-in page decodes it back out).
 */
export function signInReturnPath(returnPath: string): string {
  return `/sign-in?${new URLSearchParams({ callbackURL: returnPath }).toString()}`;
}

/**
 * Resolve `value` against the *browser's* origin, rejecting anything that would leave it.
 *
 * @remarks
 * The client-side binding of {@link sameOriginPath}, which owns the URL reasoning; this function
 * owns only the one thing that is specific to running in a browser — that with no `window` there is
 * no origin to compare against, and the honest answer is `null` rather than a guess. Every caller
 * here (the interlock, the sign-in screen) runs in an event handler or an effect, so a `window` is
 * always present in practice and the guard is a correctness floor, not a code path.
 *
 * The server has no `window` and therefore cannot use this. It resolves against a fixed placeholder
 * origin instead — see `safeServerReturnPath` in `lib/server-session.ts`, which delegates to the
 * same shared check.
 *
 * @param value - The raw candidate, typically a `?callbackURL=` query value.
 * @returns The safe same-origin path, or `null`.
 */
export function safeSameOriginPath(value: string | null | undefined): string | null {
  if (typeof window === 'undefined') return null;
  return sameOriginPath(value, window.location.origin);
}

/** lastOrgStorageKey derives a stable app shell storage or navigation key. */
export function lastOrgStorageKey(userId: string): string {
  return `docket:last-org:${userId}`;
}

/** readLastOrg reads persisted app shell preferences from browser storage. */
export function readLastOrg(userId: string | null): string | null {
  if (!userId || typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(lastOrgStorageKey(userId));
  } catch {
    return null;
  }
}

/** writeLastOrg writes persisted app shell preferences to browser storage. */
export function writeLastOrg(userId: string | null, orgId: string): void {
  if (!userId || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(lastOrgStorageKey(userId), orgId);
  } catch {
    // Non-fatal: persistence is best-effort.
  }
}

/** densityStorageKey derives a stable app shell storage or navigation key. */
export function densityStorageKey(userId: string): string {
  return `docket:density:${userId}`;
}

/** readDensity reads persisted app shell preferences from browser storage. */
export function readDensity(userId: string | null): Density {
  if (!userId || typeof window === 'undefined') return 'comfortable';
  try {
    const raw = window.localStorage.getItem(densityStorageKey(userId));
    return DENSITIES.includes(raw as Density) ? (raw as Density) : 'comfortable';
  } catch {
    return 'comfortable';
  }
}

/** writeDensity writes persisted app shell preferences to browser storage. */
export function writeDensity(userId: string | null, density: Density): void {
  if (!userId || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(densityStorageKey(userId), density);
  } catch {
    // Non-fatal: persistence is best-effort.
  }
}

/** recoveryNudgeDismissedKey derives the per-user key for the recovery-codes nudge dismissal. */
export function recoveryNudgeDismissedKey(userId: string): string {
  return `docket:recovery-nudge-dismissed:${userId}`;
}

/** readRecoveryNudgeDismissed reads whether the recovery-codes nudge was dismissed. */
export function readRecoveryNudgeDismissed(userId: string | null): boolean {
  if (!userId || typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(recoveryNudgeDismissedKey(userId)) === '1';
  } catch {
    return false;
  }
}

/** writeRecoveryNudgeDismissed persists (or clears) the recovery-codes nudge dismissal (best-effort). */
export function writeRecoveryNudgeDismissed(userId: string | null, dismissed: boolean): void {
  if (!userId || typeof window === 'undefined') return;
  try {
    if (dismissed) window.localStorage.setItem(recoveryNudgeDismissedKey(userId), '1');
    else window.localStorage.removeItem(recoveryNudgeDismissedKey(userId));
  } catch {
    // Non-fatal: persistence is best-effort.
  }
}

/** resolveActiveOrg supports the app shell workflow. */
export function resolveActiveOrg(
  routeOrgId: string | null,
  orgs: readonly OrgSummary[],
  lastOrgId: string | null,
): string | null {
  if (routeOrgId) return routeOrgId;
  if (orgs.length === 0) return null;
  if (lastOrgId && orgs.some((o) => o.id === lastOrgId)) return lastOrgId;
  const personal = orgs.find((o) => o.isPersonal);
  return personal?.id ?? orgs[0]?.id ?? null;
}

/**
 * renderLink renders an app-shell navigation item with the correct active state.
 *
 * @remarks
 * {@link DocketLink} rather than `next/link`, because these are the links a person reaches for
 * *first* when the connection drops. Offline, a `next/link` click here would fail its RSC fetch and
 * fall back to a full document navigation, tearing down the very shell this function is drawing.
 */
export function renderLink(href: string, content: ReactNode, className?: string): ReactNode {
  return (
    <DocketLink href={href} className={className}>
      {content}
    </DocketLink>
  );
}
