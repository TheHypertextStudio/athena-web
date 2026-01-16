'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined';
import RadioButtonUncheckedOutlined from '@mui/icons-material/RadioButtonUncheckedOutlined';
import ScheduleOutlined from '@mui/icons-material/ScheduleOutlined';
import ErrorOutlineOutlined from '@mui/icons-material/ErrorOutlineOutlined';
import CalendarTodayOutlined from '@mui/icons-material/CalendarTodayOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import DeleteOutlined from '@mui/icons-material/DeleteOutlined';
import ArrowBackOutlined from '@mui/icons-material/ArrowBackOutlined';
import type { SvgIconComponent } from '@mui/icons-material';
import { Header, PageContainer } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { tasksApi, type Task } from '@/lib/api-client';
import { signOutWithCleanup } from '@/lib/auth-client';

const statusIcons: Record<Task['status'], SvgIconComponent> = {
  pending: RadioButtonUncheckedOutlined,
  in_progress: ScheduleOutlined,
  completed: CheckCircleOutlined,
  cancelled: ErrorOutlineOutlined,
};

const statusLabels = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
} as const;

const priorityColors = {
  low: 'bg-slate-500',
  medium: 'bg-blue-500',
  high: 'bg-orange-500',
  urgent: 'bg-red-500',
} as const;

export default function TaskDetailPage() {
  const router = useRouter();
  const params = useParams();
  const taskId = params.id as string;

  const [task, setTask] = useState<Task | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleSignOut() {
    await signOutWithCleanup();
    router.push('/signin');
  }

  useEffect(() => {
    async function fetchTask() {
      try {
        const response = await tasksApi.get(taskId);
        setTask(response.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load task');
      } finally {
        setIsLoading(false);
      }
    }
    void fetchTask();
  }, [taskId]);

  async function handleDelete() {
    if (!confirm('Are you sure you want to delete this task?')) return;

    setIsDeleting(true);
    try {
      await tasksApi.delete(taskId);
      router.push('/tasks');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete task');
      setIsDeleting(false);
    }
  }

  async function handleStatusChange(newStatus: Task['status']) {
    if (!task) return;

    try {
      const response = await tasksApi.update(taskId, { status: newStatus });
      setTask(response.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status');
    }
  }

  return (
    <div className="flex h-full flex-col">
      <Header title="Task Details" onSignOut={() => void handleSignOut()} />

      <div className="flex-1 overflow-auto p-6">
        <PageContainer maxWidth="medium">
          <Link
            href="/tasks"
            className="text-muted-foreground hover:text-foreground mb-6 inline-flex items-center gap-2 text-sm"
          >
            <ArrowBackOutlined sx={{ fontSize: 16 }} />
            Back to Tasks
          </Link>

          {isLoading ? (
            <Card>
              <CardHeader>
                <Skeleton className="h-6 w-48" />
              </CardHeader>
              <CardContent className="space-y-4">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </CardContent>
            </Card>
          ) : error ? (
            <Card>
              <CardContent className="p-6">
                <p className="text-destructive text-center">{error}</p>
              </CardContent>
            </Card>
          ) : task ? (
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-2xl">{task.title}</CardTitle>
                    <div className="flex items-center gap-3">
                      <Badge
                        variant="secondary"
                        className={`${priorityColors[task.priority]} text-white`}
                      >
                        {task.priority}
                      </Badge>
                      {(() => {
                        const StatusIcon = statusIcons[task.status];
                        return (
                          <span className="text-muted-foreground flex items-center gap-1 text-sm">
                            <StatusIcon sx={{ fontSize: 16 }} />
                            {statusLabels[task.status]}
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outlined" size="sm" asChild>
                      <Link href={`/tasks/${taskId}/edit`}>
                        <EditOutlined sx={{ fontSize: 16 }} className="mr-2" />
                        Edit
                      </Link>
                    </Button>
                    <Button
                      variant="filled"
                      size="sm"
                      onClick={() => void handleDelete()}
                      disabled={isDeleting}
                      className="bg-error text-on-error hover:bg-error/90"
                    >
                      <DeleteOutlined sx={{ fontSize: 16 }} className="mr-2" />
                      {isDeleting ? 'Deleting...' : 'Delete'}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {task.description && (
                  <div>
                    <h3 className="text-muted-foreground mb-2 text-sm font-medium">Description</h3>
                    <p className="whitespace-pre-wrap">{task.description}</p>
                  </div>
                )}

                <Separator />

                <div className="grid gap-4 sm:grid-cols-2">
                  {task.deadline && (
                    <div>
                      <h3 className="text-muted-foreground mb-1 text-sm font-medium">Deadline</h3>
                      <p className="flex items-center gap-2">
                        <CalendarTodayOutlined
                          sx={{ fontSize: 16 }}
                          className="text-muted-foreground"
                        />
                        {new Date(task.deadline).toLocaleDateString('en-US', {
                          weekday: 'long',
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                        })}
                      </p>
                    </div>
                  )}
                  {task.estimatedMinutes && (
                    <div>
                      <h3 className="text-muted-foreground mb-1 text-sm font-medium">
                        Estimated Time
                      </h3>
                      <p className="flex items-center gap-2">
                        <ScheduleOutlined sx={{ fontSize: 16 }} className="text-muted-foreground" />
                        {task.estimatedMinutes >= 60
                          ? `${String(Math.floor(task.estimatedMinutes / 60))}h ${String(task.estimatedMinutes % 60)}m`
                          : `${String(task.estimatedMinutes)}m`}
                      </p>
                    </div>
                  )}
                </div>

                <Separator />

                <div>
                  <h3 className="text-muted-foreground mb-3 text-sm font-medium">Quick Actions</h3>
                  <div className="flex flex-wrap gap-2">
                    {task.status !== 'in_progress' && task.status !== 'completed' && (
                      <Button
                        variant="outlined"
                        size="sm"
                        onClick={() => void handleStatusChange('in_progress')}
                      >
                        <ScheduleOutlined sx={{ fontSize: 16 }} className="mr-2" />
                        Start Working
                      </Button>
                    )}
                    {task.status !== 'completed' && (
                      <Button
                        variant="outlined"
                        size="sm"
                        onClick={() => void handleStatusChange('completed')}
                      >
                        <CheckCircleOutlined sx={{ fontSize: 16 }} className="mr-2" />
                        Mark Complete
                      </Button>
                    )}
                    {task.status === 'completed' && (
                      <Button
                        variant="outlined"
                        size="sm"
                        onClick={() => void handleStatusChange('pending')}
                      >
                        <RadioButtonUncheckedOutlined sx={{ fontSize: 16 }} className="mr-2" />
                        Reopen
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </PageContainer>
      </div>
    </div>
  );
}
