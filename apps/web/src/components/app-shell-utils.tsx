import type { OrgSummary } from '@docket/types';
import {
  DENSITIES,
  type Density,
  type HomeNavKey,
  type WorkspaceNavKey,
} from '@docket/ui/components';
import Link from 'next/link';
import type { ReactNode } from 'react';

export function homeKeyFromPath(pathname: string): HomeNavKey | undefined {
  if (/^\/today(?:\/|$)/.test(pathname)) return 'today';
  if (/^\/inbox(?:\/|$)/.test(pathname)) return 'inbox';
  if (/^\/portfolio(?:\/|$)/.test(pathname)) return 'portfolio';
  return undefined;
}

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
  'initiatives',
  'programs',
  'projects',
  'cycles',
  'teams',
  'views',
  'agents',
  'settings',
];

export function workspaceKeyFromPath(pathname: string): WorkspaceNavKey | undefined {
  for (const key of NAV_SEGMENTS) {
    if (new RegExp(`^/orgs/[^/]+/${key}(?:/|$)`).test(pathname)) return key;
  }
  return undefined;
}

export function lastOrgStorageKey(userId: string): string {
  return `docket:last-org:${userId}`;
}

export function readLastOrg(userId: string | null): string | null {
  if (!userId || typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(lastOrgStorageKey(userId));
  } catch {
    return null;
  }
}

export function writeLastOrg(userId: string | null, orgId: string): void {
  if (!userId || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(lastOrgStorageKey(userId), orgId);
  } catch {
    // Non-fatal: persistence is best-effort.
  }
}

export function densityStorageKey(userId: string): string {
  return `docket:density:${userId}`;
}

export function readDensity(userId: string | null): Density {
  if (!userId || typeof window === 'undefined') return 'comfortable';
  try {
    const raw = window.localStorage.getItem(densityStorageKey(userId));
    return DENSITIES.includes(raw as Density) ? (raw as Density) : 'comfortable';
  } catch {
    return 'comfortable';
  }
}

export function writeDensity(userId: string | null, density: Density): void {
  if (!userId || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(densityStorageKey(userId), density);
  } catch {
    // Non-fatal: persistence is best-effort.
  }
}

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

export function renderLink(href: string, content: ReactNode, className?: string): ReactNode {
  return (
    <Link href={href} className={className}>
      {content}
    </Link>
  );
}
