'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard,
  CheckSquare,
  FolderKanban,
  Target,
  Calendar,
  CalendarDays,
  Clock,
  Settings,
  LogOut,
  ChevronDown,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ProgressBar } from '@/components/ui/progress-bar';
import {
  initiativesApi,
  projectsApi,
  tasksApi,
  type InitiativeStatusCategory,
} from '@/lib/api-client';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const mainNavItems: NavItem[] = [
  { href: '/home', label: 'Home', icon: CalendarDays },
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/tasks', label: 'Tasks', icon: CheckSquare },
  { href: '/projects', label: 'Projects', icon: FolderKanban },
  { href: '/initiatives', label: 'Initiatives', icon: Target },
  { href: '/calendar', label: 'Calendar', icon: Calendar },
  { href: '/moments', label: 'Moments', icon: Clock },
];

const bottomNavItems: NavItem[] = [{ href: '/settings', label: 'Settings', icon: Settings }];

interface InitiativeWithProgress {
  id: string;
  name: string;
  status: InitiativeStatusCategory;
  progress: number;
  isStrategicPriority?: boolean;
}

interface SidebarProps {
  onSignOut: () => void;
}

export function Sidebar({ onSignOut }: SidebarProps) {
  const pathname = usePathname();
  const [initiativesExpanded, setInitiativesExpanded] = useState(true);

  // Fetch active initiatives for quick-access
  const { data: initiativesData } = useQuery({
    queryKey: ['initiatives', { category: 'active' }],
    queryFn: () => initiativesApi.list({ category: 'active' }),
  });

  // Fetch projects for progress calculation
  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.list(),
  });

  // Fetch tasks for progress calculation
  const { data: tasksData } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => tasksApi.list(),
  });

  // Calculate progress for each active initiative
  const initiativesWithProgress: InitiativeWithProgress[] = (initiativesData?.data ?? [])
    .slice(0, 5)
    .map((initiative) => {
      const projects = (projectsData?.data ?? []).filter((p) => p.initiativeId === initiative.id);
      const projectIds = new Set(projects.map((p) => p.id));
      const tasks = (tasksData?.data ?? []).filter(
        (t) => t.projectId && projectIds.has(t.projectId),
      );
      const completedTasks = tasks.filter((t) => t.status === 'completed').length;
      const totalTasks = tasks.length;
      const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

      return {
        id: initiative.id,
        name: initiative.name,
        status: initiative.statusCategory ?? 'planning',
        progress,
        isStrategicPriority: false,
      };
    });

  const hasMoreInitiatives = (initiativesData?.data ?? []).length > 5;

  return (
    <aside className="bg-card flex h-screen w-64 flex-col border-r">
      <div className="flex h-16 items-center border-b px-6">
        <Link href="/home" className="flex items-center gap-2">
          <div className="bg-primary flex h-8 w-8 items-center justify-center rounded-lg">
            <Target className="text-primary-foreground h-5 w-5" />
          </div>
          <span className="text-xl font-bold">Athena</span>
        </Link>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {mainNavItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </Link>
          );
        })}

        {/* Active Initiatives Quick-Access */}
        {initiativesWithProgress.length > 0 && (
          <div className="border-border mt-4 border-t pt-4">
            <button
              type="button"
              onClick={() => {
                setInitiativesExpanded(!initiativesExpanded);
              }}
              className="text-muted-foreground hover:text-foreground flex w-full items-center justify-between px-3 py-1 text-xs font-medium tracking-wide uppercase"
            >
              Active Initiatives
              <ChevronDown
                className={cn(
                  'h-3.5 w-3.5 transition-transform',
                  initiativesExpanded && 'rotate-180',
                )}
              />
            </button>
            {initiativesExpanded && (
              <div className="mt-2 space-y-1">
                {initiativesWithProgress.map((initiative) => (
                  <Link
                    key={initiative.id}
                    href={`/initiatives/${initiative.id}`}
                    className={cn(
                      'block rounded-lg px-3 py-2 transition-colors',
                      pathname === `/initiatives/${initiative.id}`
                        ? 'bg-accent'
                        : 'hover:bg-accent/50',
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <Target className="text-primary h-3.5 w-3.5 flex-shrink-0" />
                      <span className="flex-1 truncate text-sm font-medium">{initiative.name}</span>
                      {initiative.isStrategicPriority && <Zap className="text-tertiary h-3 w-3" />}
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <ProgressBar progress={initiative.progress} size="xs" className="bg-muted" />
                      <span className="text-muted-foreground text-[10px] tabular-nums">
                        {initiative.progress}%
                      </span>
                    </div>
                  </Link>
                ))}
                {hasMoreInitiatives && (
                  <Link
                    href="/initiatives"
                    className="text-muted-foreground hover:text-foreground block px-3 py-1 text-xs"
                  >
                    + more initiatives
                  </Link>
                )}
              </div>
            )}
          </div>
        )}
      </nav>

      <div className="px-3 py-4">
        <Separator className="mb-4" />
        {bottomNavItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </Link>
          );
        })}
        <Button
          variant="text"
          className="text-muted-foreground hover:bg-accent hover:text-accent-foreground mt-1 w-full justify-start gap-3 px-3"
          onClick={onSignOut}
        >
          <LogOut className="h-5 w-5" />
          Sign Out
        </Button>
      </div>
    </aside>
  );
}
