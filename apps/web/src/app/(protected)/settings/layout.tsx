'use client';

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

  return (
    <div className="bg-surface min-h-screen">
      <div className="mx-auto max-w-4xl px-4 py-8">
        {/* Back link */}
        <Link
          href="/home"
          className="text-on-surface-variant hover:text-on-surface mb-6 inline-flex items-center gap-2 text-sm font-medium transition-colors"
        >
          <ArrowBackIcon sx={{ fontSize: 18 }} />
          Back to Home
        </Link>

        {/* Page title */}
        <h1 className="text-on-surface mb-8 text-2xl font-semibold">Settings</h1>

        <div className="flex gap-8">
          {/* Sidebar navigation */}
          <nav className="w-52 shrink-0">
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
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </div>
    </div>
  );
}
