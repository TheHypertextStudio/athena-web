'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { TaskForm } from '@/components/tasks/task-form';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { tasksApi, type Task, type UpdateTaskInput } from '@/lib/api-client';
import { signOut } from '@/lib/auth-client';

export default function EditTaskPage() {
  const router = useRouter();
  const params = useParams();
  const taskId = params.id as string;

  const [task, setTask] = useState<Task | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignOut() {
    await signOut();
    router.push('/login');
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

  async function handleSubmit(data: UpdateTaskInput) {
    setIsSubmitting(true);
    setError(null);

    try {
      await tasksApi.update(taskId, data);
      router.push(`/tasks/${taskId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update task');
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <Header title="Edit Task" onSignOut={() => void handleSignOut()} />

      <div className="flex-1 p-6">
        <div className="mx-auto max-w-2xl">
          <Link
            href={`/tasks/${taskId}`}
            className="text-muted-foreground hover:text-foreground mb-6 inline-flex items-center gap-2 text-sm"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Task
          </Link>

          {error && (
            <div className="bg-destructive/10 text-destructive mb-6 rounded-lg p-4 text-sm">
              {error}
            </div>
          )}

          {isLoading ? (
            <Card>
              <CardContent className="space-y-4 p-6">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-10 w-full" />
              </CardContent>
            </Card>
          ) : task ? (
            <TaskForm
              initialData={task}
              onSubmit={(data) => {
                void handleSubmit(data);
              }}
              isSubmitting={isSubmitting}
              onCancel={() => {
                router.back();
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
