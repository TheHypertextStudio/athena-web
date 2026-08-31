'use client';

import { IdentityGlyph, SidebarNavItem, useShellSidebar } from '@docket/ui/components';
import { LogOut, Shield } from '@docket/ui/icons';
import { Separator, Stack, Text, TooltipProvider } from '@docket/ui/primitives';
import Link from 'next/link';
import type { JSX } from 'react';

import { ADMIN_NAV, type AdminNavItem, isActiveRoute } from '@/components/admin-nav';
import type { AdminQueueCounts } from '@/lib/use-admin-queues';

/** Props for {@link AdminSidebar}. */
export interface AdminSidebarProps {
  /** The current route, used to mark the active entry. */
  readonly pathname: string;
  /** Live queue depths shown as attention badges. */
  readonly queues: AdminQueueCounts;
  /** The signed-in operator's email, or `null` while the session resolves. */
  readonly email: string | null;
  /** The operator's staff tier, or `null` while it resolves. */
  readonly tier: string | null;
  /** Whether a sign-out is in flight. */
  readonly signingOut: boolean;
  /** Sign the operator out. */
  readonly onSignOut: () => void;
}

/**
 * The operator console's navigation.
 *
 * @remarks
 * Composed from the shared {@link SidebarNavItem} rather than hand-rolled links, so the console's
 * nav rows are the same component — same density, same active tone, same inset focus ring, same
 * collapsed-to-glyph behaviour with a tooltip — as the product app's. The sidebar deliberately
 * carries no panel chrome: it blends into the shell's tinted canvas, and the routed content is the
 * one distinct floating surface.
 *
 * Two entries carry live attention counts, so queue depth is visible from anywhere in the console
 * rather than only after opening the screen.
 *
 * The footer states the operator's **staff tier**, which is the console's most load-bearing piece
 * of context and was previously invisible: every admin route is gated on tier, so without it an
 * operator learns what they may do only when an action fails.
 *
 * Self-wrapped in a {@link TooltipProvider}, mirroring the product's own `Sidebar`: a collapsed nav
 * row moves its label into a tooltip, so the sidebar carries a provider to stay renderable in both
 * shell slots — the static desktop rail and the mobile drawer — without depending on an ancestor.
 */
export function AdminSidebar({
  pathname,
  queues,
  email,
  tier,
  signingOut,
  onSignOut,
}: AdminSidebarProps): JSX.Element {
  const { collapsed } = useShellSidebar();

  return (
    <TooltipProvider>
      <aside
        aria-label="Navigation"
        className="text-on-surface flex h-full w-full shrink-0 flex-col p-2 lg:w-60"
      >
        <div className="flex shrink-0 items-center gap-2 px-3 py-2">
          <IdentityGlyph size={28}>
            <Shield className="size-4" />
          </IdentityGlyph>
          {collapsed ? null : (
            <div className="min-w-0">
              <Text as="p" token="label-large" truncate>
                Docket
              </Text>
              <Text as="p" token="label-small" tone="muted" truncate>
                Service admin
              </Text>
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {ADMIN_NAV.map((section) => (
            <div key={section.title ?? 'overview'}>
              {section.title && !collapsed ? (
                <Text as="p" token="title-small" tone="muted" className="mt-4 mb-1 px-3">
                  {section.title}
                </Text>
              ) : null}
              <nav
                aria-label={section.title ?? 'Overview'}
                className="flex flex-col space-y-0.5 pt-0.5"
              >
                {section.items.map((item) => (
                  <NavRow
                    key={item.href}
                    item={item}
                    active={isActiveRoute(pathname, item.href)}
                    count={item.counter ? queues[item.counter] : undefined}
                    collapsed={collapsed}
                  />
                ))}
              </nav>
            </div>
          ))}
        </div>

        <Stack gap={2} className="shrink-0 pt-2">
          <Separator />
          {collapsed ? null : (
            <div className="min-w-0 px-3">
              {email ? (
                <Text as="p" token="body-small" truncate title={email}>
                  {email}
                </Text>
              ) : null}
              {tier ? (
                <Text as="p" token="label-small" tone="muted" truncate>
                  {tier}
                </Text>
              ) : null}
            </div>
          )}
          <SidebarNavItem
            label={signingOut ? 'Signing out…' : 'Sign out'}
            icon={LogOut}
            onSelect={onSignOut}
            disabled={signingOut}
            collapsed={collapsed}
          />
        </Stack>
      </aside>
    </TooltipProvider>
  );
}

/** One nav row, rendered as a real link so it is right-clickable and prefetchable. */
function NavRow({
  item,
  active,
  count,
  collapsed,
}: {
  readonly item: AdminNavItem;
  readonly active: boolean;
  readonly count: number | undefined;
  readonly collapsed: boolean;
}): JSX.Element {
  const Icon = item.icon;
  return (
    <SidebarNavItem
      label={item.label}
      icon={Icon}
      active={active}
      collapsed={collapsed}
      {...(count !== undefined ? { badge: count } : {})}
      {...(item.badgeLabel ? { badgeLabel: item.badgeLabel } : {})}
      asChild
    >
      <Link href={item.href}>
        <Icon aria-hidden="true" className="size-4 shrink-0" />
        <span className="truncate">{item.label}</span>
      </Link>
    </SidebarNavItem>
  );
}
