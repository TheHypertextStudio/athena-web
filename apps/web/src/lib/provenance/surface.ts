import type { HomeNavKey, WorkspaceNavKey } from '@docket/ui/components';
import { type AppSurface, SURFACE_HEADER } from '@docket/work/provenance-contract';

import {
  homeKeyFromPath,
  isObjectDetailPath,
  workspaceKeyFromPath,
} from '@/components/app-shell-utils';

/** The surface each personal navigation destination records. */
const HOME_SURFACES: Readonly<Record<HomeNavKey, AppSurface | null>> = {
  today: 'home',
  tasks: 'list',
  calendar: 'calendar',
  time: 'calendar',
  inbox: 'inbox',
  drafts: null,
  athena: null,
  stream: 'list',
  portfolio: 'list',
  search: 'list',
};

/** The surface each workspace navigation destination records. */
const WORKSPACE_SURFACES: Readonly<Record<WorkspaceNavKey, AppSurface | null>> = {
  'my-work': 'home',
  triage: 'inbox',
  tasks: 'list',
  stream: 'list',
  initiatives: 'list',
  programs: 'list',
  projects: 'list',
  cycles: 'list',
  library: null,
  teams: null,
  people: null,
  views: 'list',
  graph: 'canvas',
  settings: 'settings',
};

/** The planning canvas, personal or in a workspace. */
const PLAN_PATH = /^\/(?:orgs\/[^/]+\/)?plans?(?:\/|$)/;

/**
 * The app surface a path belongs to, for provenance.
 *
 * @param pathname - The current `location.pathname`.
 * @returns the surface, or null for pages that are not a surface work is changed from.
 */
export function appSurfaceForPath(pathname: string): AppSurface | null {
  if (isObjectDetailPath(pathname)) return 'detail';
  if (PLAN_PATH.test(pathname)) return 'plan';
  const workspaceKey = workspaceKeyFromPath(pathname);
  if (workspaceKey) return WORKSPACE_SURFACES[workspaceKey];
  const homeKey = homeKeyFromPath(pathname);
  return homeKey ? HOME_SURFACES[homeKey] : null;
}

/** A path and the provenance headers it produces. */
interface SurfaceLookup {
  readonly pathname: string;
  readonly headers: Readonly<Record<string, string>>;
}

/** The last path looked up; the surface changes only on navigation. */
let cached: SurfaceLookup | null = null;

/**
 * The provenance header for a request sent from the current page.
 *
 * @returns the header to send, or none outside the browser or off a surface.
 */
export function surfaceHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const { pathname } = window.location;
  if (cached?.pathname !== pathname) {
    const surface = appSurfaceForPath(pathname);
    cached = { pathname, headers: surface ? { [SURFACE_HEADER]: surface } : {} };
  }
  return { ...cached.headers };
}
