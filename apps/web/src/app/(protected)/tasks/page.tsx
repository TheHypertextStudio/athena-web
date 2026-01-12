/**
 * Tasks page.
 *
 * Displays all tasks organized into smart sections (Focus, Up Next, Later, Completed).
 * Uses route interception for task details - clicking a task opens a modal overlay.
 *
 * @packageDocumentation
 */

'use client';

import { useRouter } from 'next/navigation';
import { Header, PageContainer } from '@/components/layout';
import { TaskListView } from '@/components/tasks/task-list-view';
import { signOut } from '@/lib/auth-client';

export default function TasksPage() {
  const router = useRouter();

  async function handleSignOut() {
    await signOut();
    router.push('/login');
  }

  return (
    <div className="flex h-full flex-col">
      <Header title="Tasks" onSignOut={() => void handleSignOut()} />
      <div className="flex-1 overflow-auto p-6">
        <PageContainer>
          <TaskListView />
        </PageContainer>
      </div>
    </div>
  );
}
