'use client';

import { useEffect, useState } from 'react';
import CheckBoxOutlined from '@mui/icons-material/CheckBoxOutlined';
import ViewKanbanOutlined from '@mui/icons-material/ViewKanbanOutlined';
import GpsFixedOutlined from '@mui/icons-material/GpsFixedOutlined';
import CalendarTodayOutlined from '@mui/icons-material/CalendarTodayOutlined';
import type { SvgIconComponent } from '@mui/icons-material';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { tasksApi, projectsApi, initiativesApi, eventsApi } from '@/lib/api-client';

interface StatCardProps {
  title: string;
  value: number | null;
  icon: SvgIconComponent;
  description: string;
}

function StatCard({ title, value, icon: Icon, description }: StatCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon sx={{ fontSize: 16 }} className="text-muted-foreground" />
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
          initiativesApi.list({ category: 'active' }),
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
        icon={CheckBoxOutlined}
        description="Tasks awaiting action"
      />
      <StatCard
        title="Active Projects"
        value={stats.activeProjects}
        icon={ViewKanbanOutlined}
        description="Currently in progress"
      />
      <StatCard
        title="Active Initiatives"
        value={stats.activeInitiatives}
        icon={GpsFixedOutlined}
        description="Strategic goals"
      />
      <StatCard
        title="Upcoming Events"
        value={stats.upcomingEvents}
        icon={CalendarTodayOutlined}
        description="Next 7 days"
      />
    </div>
  );
}
