'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Header, PageContainer } from '@/components/layout';
import { TaskForm } from '@/components/tasks/task-form';
import { tasksApi, type CreateTaskInput } from '@/lib/api-client';
import { signOut } from '@/lib/auth-client';

export default function NewTaskPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignOut() {
    await signOut();
    router.push('/login');
  }

  async function handleSubmit(data: CreateTaskInput) {
    setIsSubmitting(true);
    setError(null);

    try {
      await tasksApi.create(data);
      router.push('/tasks');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task');
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <Header title="New Task" onSignOut={() => void handleSignOut()} />

      <div className="flex-1 overflow-auto p-6">
        <PageContainer maxWidth="narrow">
          {error && (
            <div className="bg-destructive/10 text-destructive mb-6 rounded-lg p-4 text-sm">
              {error}
            </div>
          )}
          <TaskForm
            onSubmit={(data) => {
              void handleSubmit(data);
            }}
            isSubmitting={isSubmitting}
            onCancel={() => {
              router.back();
            }}
          />
        </PageContainer>
      </div>
    </div>
  );
}
