'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined';
import RadioButtonUncheckedOutlined from '@mui/icons-material/RadioButtonUncheckedOutlined';
import ScheduleOutlined from '@mui/icons-material/ScheduleOutlined';
import ErrorOutlineOutlined from '@mui/icons-material/ErrorOutlineOutlined';
import ArrowForwardOutlined from '@mui/icons-material/ArrowForwardOutlined';
import type { SvgIconComponent } from '@mui/icons-material';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { tasksApi, type Task } from '@/lib/api-client';

const priorityColors = {
  low: 'bg-slate-500',
  medium: 'bg-blue-500',
  high: 'bg-orange-500',
  urgent: 'bg-red-500',
} as const;

const statusIcons: Record<Task['status'], SvgIconComponent> = {
  pending: RadioButtonUncheckedOutlined,
  in_progress: ScheduleOutlined,
  completed: CheckCircleOutlined,
  cancelled: ErrorOutlineOutlined,
};

export function TaskSummary() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchTasks() {
      try {
        const response = await tasksApi.list({ status: 'pending' });
        setTasks(response.data.slice(0, 5));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load tasks');
      } finally {
        setIsLoading(false);
      }
    }
    void fetchTasks();
  }, []);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Upcoming Tasks</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-5 w-5 rounded-full" />
              <Skeleton className="h-4 flex-1" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Upcoming Tasks</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">{error}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Upcoming Tasks</CardTitle>
        <Link
          href="/tasks"
          className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm"
        >
          View all <ArrowForwardOutlined sx={{ fontSize: 16 }} />
        </Link>
      </CardHeader>
      <CardContent>
        {tasks.length === 0 ? (
          <p className="text-muted-foreground text-sm">No pending tasks. Great job!</p>
        ) : (
          <ul className="space-y-3">
            {tasks.map((task) => {
              const StatusIcon = statusIcons[task.status];
              return (
                <li key={task.id}>
                  <Link
                    href={`/tasks/${task.id}`}
                    className="hover:bg-accent flex items-center gap-3 rounded-lg p-2 transition-colors"
                  >
                    <StatusIcon sx={{ fontSize: 20 }} className="text-muted-foreground" />
                    <span className="flex-1 truncate text-sm">{task.title}</span>
                    <Badge
                      variant="secondary"
                      className={`${priorityColors[task.priority]} text-white`}
                    >
                      {task.priority}
                    </Badge>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
