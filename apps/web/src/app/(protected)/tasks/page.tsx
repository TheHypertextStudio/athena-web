'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Filter, CheckCircle2, Circle, Clock, AlertCircle, Search } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { tasksApi, type Task } from '@/lib/api-client';
import { signOut } from '@/lib/auth-client';
import { useRouter } from 'next/navigation';

type TaskStatus = Task['status'];
type TaskPriority = Task['priority'];

const statusIcons = {
  pending: Circle,
  in_progress: Clock,
  completed: CheckCircle2,
  cancelled: AlertCircle,
} as const;

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

export default function TasksPage() {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'all'>('all');
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  async function handleSignOut() {
    await signOut();
    router.push('/login');
  }

  useEffect(() => {
    async function fetchTasks() {
      try {
        const params: { status?: TaskStatus; priority?: TaskPriority } = {};
        if (statusFilter !== 'all') params.status = statusFilter;
        if (priorityFilter !== 'all') params.priority = priorityFilter;

        const response = await tasksApi.list(params);
        setTasks(response.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load tasks');
      } finally {
        setIsLoading(false);
      }
    }
    void fetchTasks();
  }, [statusFilter, priorityFilter]);

  const filteredTasks = tasks.filter((task) =>
    task.title.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const groupedTasks = filteredTasks.reduce<Partial<Record<TaskStatus, Task[]>>>((acc, task) => {
    const existingGroup = acc[task.status];
    const statusGroup = existingGroup ?? [];
    statusGroup.push(task);
    acc[task.status] = statusGroup;
    return acc;
  }, {});

  return (
    <div className="flex h-full flex-col">
      <Header title="Tasks" onSignOut={() => void handleSignOut()} />

      <div className="flex-1 space-y-6 p-6">
        {/* Actions Bar */}
        <div className="flex items-center justify-between gap-4">
          <div className="relative max-w-md flex-1">
            <Search className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search tasks..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
              }}
              className="bg-background border-input placeholder:text-muted-foreground focus-visible:ring-ring w-full rounded-md border py-2 pl-10 pr-4 text-sm focus-visible:outline-none focus-visible:ring-1"
            />
          </div>

          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Filter className="mr-2 h-4 w-4" />
                  Status: {statusFilter === 'all' ? 'All' : statusLabels[statusFilter]}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>Filter by Status</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    setStatusFilter('all');
                  }}
                >
                  All
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setStatusFilter('pending');
                  }}
                >
                  Pending
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setStatusFilter('in_progress');
                  }}
                >
                  In Progress
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setStatusFilter('completed');
                  }}
                >
                  Completed
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setStatusFilter('cancelled');
                  }}
                >
                  Cancelled
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Filter className="mr-2 h-4 w-4" />
                  Priority: {priorityFilter === 'all' ? 'All' : priorityFilter}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>Filter by Priority</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    setPriorityFilter('all');
                  }}
                >
                  All
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setPriorityFilter('urgent');
                  }}
                >
                  Urgent
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setPriorityFilter('high');
                  }}
                >
                  High
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setPriorityFilter('medium');
                  }}
                >
                  Medium
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setPriorityFilter('low');
                  }}
                >
                  Low
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button asChild>
              <Link href="/tasks/new">
                <Plus className="mr-2 h-4 w-4" />
                New Task
              </Link>
            </Button>
          </div>
        </div>

        {/* Task List */}
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-5 w-5 rounded-full" />
                    <Skeleton className="h-4 flex-1" />
                    <Skeleton className="h-5 w-16" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : error ? (
          <Card>
            <CardContent className="p-6">
              <p className="text-muted-foreground text-center">{error}</p>
            </CardContent>
          </Card>
        ) : filteredTasks.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <p className="text-muted-foreground">No tasks found</p>
              <Button asChild className="mt-4">
                <Link href="/tasks/new">Create your first task</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {(Object.keys(groupedTasks) as TaskStatus[]).map((status) => {
              const tasksInGroup = groupedTasks[status];
              if (!tasksInGroup) return null;
              return (
                <Card key={status}>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      {(() => {
                        const StatusIcon = statusIcons[status];
                        return <StatusIcon className="h-4 w-4" />;
                      })()}
                      {statusLabels[status]}
                      <Badge variant="secondary" className="ml-2">
                        {tasksInGroup.length}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {tasksInGroup.map((task) => {
                      const StatusIcon = statusIcons[task.status];
                      return (
                        <Link
                          key={task.id}
                          href={`/tasks/${task.id}`}
                          className="hover:bg-accent flex items-center gap-3 rounded-lg border p-3 transition-colors"
                        >
                          <StatusIcon className="text-muted-foreground h-5 w-5 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">{task.title}</p>
                            {task.description && (
                              <p className="text-muted-foreground truncate text-sm">
                                {task.description}
                              </p>
                            )}
                          </div>
                          <Badge
                            variant="secondary"
                            className={`${priorityColors[task.priority]} shrink-0 text-white`}
                          >
                            {task.priority}
                          </Badge>
                          {task.deadline && (
                            <span className="text-muted-foreground shrink-0 text-xs">
                              {new Date(task.deadline).toLocaleDateString()}
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
