'use client';

import { useEffect, useState } from 'react';
import { CheckSquare, FolderKanban, Target, Calendar } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { tasksApi, projectsApi, initiativesApi, eventsApi } from '@/lib/api-client';

interface StatCardProps {
  title: string;
  value: number | null;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}

function StatCard({ title, value, icon: Icon, description }: StatCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="text-muted-foreground h-4 w-4" />
      </CardHeader>
      <CardContent>
        {value === null ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <div className="text-2xl font-bold">{value}</div>
        )}
        <p className="text-muted-foreground text-xs">{description}</p>
      </CardContent>
    </Card>
  );
}

export function StatsCards() {
  const [stats, setStats] = useState({
    pendingTasks: null as number | null,
    activeProjects: null as number | null,
    activeInitiatives: null as number | null,
    upcomingEvents: null as number | null,
  });

  useEffect(() => {
    async function fetchStats() {
      try {
        const [tasks, projects, initiatives, events] = await Promise.all([
          tasksApi.list({ status: 'pending' }),
          projectsApi.list({ status: 'active' }),
          initiativesApi.list({ status: 'active' }),
          eventsApi.list({
            startDate: new Date().toISOString(),
            endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          }),
        ]);

        setStats({
          pendingTasks: tasks.data.length,
          activeProjects: projects.data.length,
          activeInitiatives: initiatives.data.length,
          upcomingEvents: events.data.length,
        });
      } catch {
        // Silent fail - cards will show loading state
      }
    }
    void fetchStats();
  }, []);

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <StatCard
        title="Pending Tasks"
        value={stats.pendingTasks}
        icon={CheckSquare}
        description="Tasks awaiting action"
      />
      <StatCard
        title="Active Projects"
        value={stats.activeProjects}
        icon={FolderKanban}
        description="Currently in progress"
      />
      <StatCard
        title="Active Initiatives"
        value={stats.activeInitiatives}
        icon={Target}
        description="Strategic goals"
      />
      <StatCard
        title="Upcoming Events"
        value={stats.upcomingEvents}
        icon={Calendar}
        description="Next 7 days"
      />
    </div>
  );
}
