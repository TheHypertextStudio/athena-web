import {
  Activity,
  Bell,
  Building,
  Home,
  type LucideIcon,
  Layers,
  Settings,
  Tag,
  Users,
} from '@docket/ui/icons';

/** Which live queue count, if any, a nav entry surfaces as its attention badge. */
export type NavCounter = 'discountReviews' | 'pendingDeletion';

/** A single navigation destination in the operator console. */
export interface AdminNavItem {
  /** The route the entry links to. */
  readonly href: string;
  /** The entry's display label. */
  readonly label: string;
  /** The glyph shown at the row's leading edge. */
  readonly icon: LucideIcon;
  /** The queue whose depth this entry surfaces, when it surfaces one. */
  readonly counter?: NavCounter | undefined;
  /** What the badge counts, folded into the row's accessible name. */
  readonly badgeLabel?: string | undefined;
}

/** A titled group of destinations. */
export interface AdminNavSection {
  /** The section heading, or `null` for the leading ungrouped entries. */
  readonly title: string | null;
  /** The destinations in the section, in display order. */
  readonly items: readonly AdminNavItem[];
}

/**
 * The operator console's navigation, grouped by the job being done rather than by data model.
 *
 * @remarks
 * The previous nav was a flat list of seven unlabelled text links whose order carried no meaning,
 * and it omitted `/lifecycle` entirely — a route that renders a full retention board and that
 * nothing linked to. Grouping states what each screen is *for*: who an account belongs to
 * (Accounts), what costs or earns money (Revenue), what the service is doing (Operations), and
 * what an operator can change about the instance (Service).
 *
 * Two entries carry live attention counts, so queue depth is visible from anywhere in the console
 * instead of only after opening the screen.
 */
export const ADMIN_NAV: readonly AdminNavSection[] = [
  {
    title: null,
    items: [{ href: '/', label: 'Dashboard', icon: Home }],
  },
  {
    title: 'Accounts',
    items: [
      { href: '/users', label: 'Users', icon: Users },
      {
        href: '/orgs',
        label: 'Organizations',
        icon: Building,
        counter: 'pendingDeletion',
        badgeLabel: 'pending deletion',
      },
    ],
  },
  {
    title: 'Revenue',
    items: [
      {
        href: '/discounts',
        label: 'Discounts',
        icon: Tag,
        counter: 'discountReviews',
        badgeLabel: 'awaiting review',
      },
    ],
  },
  {
    title: 'Operations',
    items: [
      { href: '/notifications', label: 'Announcements', icon: Bell },
      { href: '/status', label: 'Service status', icon: Activity },
      { href: '/audit', label: 'Audit log', icon: Activity },
      { href: '/lifecycle', label: 'Retention markers', icon: Layers },
    ],
  },
  {
    title: 'Service',
    items: [{ href: '/settings', label: 'Settings', icon: Settings }],
  },
];

/**
 * Whether `pathname` is within the section rooted at `href`.
 *
 * @param pathname - The current route.
 * @param href - The nav entry's target.
 * @returns `true` when the entry should read as the active route.
 */
export function isActiveRoute(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}
