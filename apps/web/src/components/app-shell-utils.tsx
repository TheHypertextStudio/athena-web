import type { OrgSummary } from '@docket/types';
import {
  DENSITIES,
  type Density,
  type HomeNavKey,
  type WorkspaceNavKey,
} from '@docket/ui/components';
import Link from 'next/link';
import type { ReactNode } from 'react';

/** homeKeyFromPath derives a stable app shell storage or navigation key. */
export function homeKeyFromPath(pathname: string): HomeNavKey | undefined {
  if (/^\/today(?:\/|$)/.test(pathname)) return 'today';
  if (/^\/tasks(?:\/|$)/.test(pathname)) return 'tasks';
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
 */
export const NAV_SEGMENTS: readonly WorkspaceNavKey[] = [
  'my-work',
  'triage',
  'stream',
  'initiatives',
  'programs',
  'projects',
  'cycles',
  'teams',
  'views',
  'graph',
  'agents',
  'settings',
];

/** workspaceKeyFromPath derives a stable app shell storage or navigation key. */
export function workspaceKeyFromPath(pathname: string): WorkspaceNavKey | undefined {
  for (const key of NAV_SEGMENTS) {
    if (new RegExp(`^/orgs/[^/]+/${key}(?:/|$)`).test(pathname)) return key;
  }
  return undefined;
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

/** renderLink renders an app-shell navigation item with the correct active state. */
export function renderLink(href: string, content: ReactNode, className?: string): ReactNode {
  return (
    <Link href={href} className={className}>
      {content}
    </Link>
  );
}
