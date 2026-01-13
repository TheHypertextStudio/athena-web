'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import CreditCardOutlinedIcon from '@mui/icons-material/CreditCardOutlined';
import ExtensionOutlinedIcon from '@mui/icons-material/ExtensionOutlined';
import NotificationsOutlinedIcon from '@mui/icons-material/NotificationsOutlined';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import StorageOutlinedIcon from '@mui/icons-material/StorageOutlined';
import TuneOutlinedIcon from '@mui/icons-material/TuneOutlined';
import { cn } from '@/lib/utils';

interface SettingsNavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ sx?: { fontSize: number }; className?: string }>;
}

const settingsNavItems: SettingsNavItem[] = [
  { href: '/settings/account', label: 'Account', icon: PersonOutlineIcon },
  { href: '/settings/security', label: 'Security', icon: ShieldOutlinedIcon },
  { href: '/settings/billing', label: 'Billing', icon: CreditCardOutlinedIcon },
  { href: '/settings/workflow', label: 'Workflow', icon: TuneOutlinedIcon },
  { href: '/settings/integrations', label: 'Integrations', icon: ExtensionOutlinedIcon },
  { href: '/settings/notifications', label: 'Notifications', icon: NotificationsOutlinedIcon },
  { href: '/settings/ai', label: 'Athena AI', icon: AutoAwesomeOutlinedIcon },
  { href: '/settings/data', label: 'Data', icon: StorageOutlinedIcon },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [isScrolled, setIsScrolled] = useState(false);

  // Track window scroll for mobile sticky header elevation
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 0);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  return (
    <div className="bg-surface min-h-screen">
      {/* Mobile: Sticky header with back link, title, and navigation */}
      <header
        className={cn(
          'duration-medium1 ease-standard sticky top-0 z-10 backdrop-blur-sm transition-[background-color,box-shadow] md:relative md:bg-transparent md:shadow-none md:backdrop-blur-none',
          isScrolled ? 'bg-surface-container-high shadow-md' : 'bg-surface/95',
        )}
      >
        <div className="mx-auto max-w-4xl px-4 pt-4 md:pt-8">
          {/* Back link */}
          <Link
            href="/home"
            className="text-on-surface-variant hover:text-on-surface mb-3 inline-flex items-center gap-2 text-sm font-medium transition-colors md:mb-6"
          >
            <ArrowBackIcon sx={{ fontSize: 18 }} />
            Back to Home
          </Link>

          {/* Page title */}
          <h1 className="text-on-surface mb-3 text-xl font-semibold md:mb-8 md:text-2xl">
            Settings
          </h1>

          {/* Mobile: Horizontal scrollable navigation */}
          <nav className="scrollbar-none -mx-4 overflow-x-auto pb-4 md:hidden">
            <ul className="inline-flex gap-2 px-4">
              {settingsNavItems.map((item) => {
                const isActive =
                  pathname === item.href ||
                  (pathname === '/settings' && item.href === '/settings/account');
                return (
                  <li key={item.href} className="shrink-0">
                    <Link
                      href={item.href}
                      className={cn(
                        'flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors',
                        isActive
                          ? 'bg-secondary-container text-on-secondary-container'
                          : 'bg-surface-container text-on-surface-variant',
                      )}
                    >
                      <item.icon sx={{ fontSize: 18 }} />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-4 py-4 md:py-0">
        <div className="flex gap-8">
          {/* Desktop: Sidebar navigation */}
          <nav className="sticky top-8 hidden h-fit w-52 shrink-0 md:block">
            <ul className="space-y-1">
              {settingsNavItems.map((item) => {
                const isActive =
                  pathname === item.href ||
                  (pathname === '/settings' && item.href === '/settings/account');
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        'flex items-center gap-3 rounded-full px-4 py-2.5 text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-secondary-container text-on-secondary-container'
                          : 'text-on-surface-variant hover:bg-surface-container-highest',
                      )}
                    >
                      <item.icon sx={{ fontSize: 20 }} />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* Content area */}
          <main className="min-w-0 flex-1 pb-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
