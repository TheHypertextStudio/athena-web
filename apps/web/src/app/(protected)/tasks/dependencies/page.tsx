'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import { useState } from 'react';
import { Header } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { TaskDependencyFlow } from '@/components/flows';
import { signOutWithCleanup } from '@/lib/auth-client';

export default function TaskDependenciesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rootTaskId = searchParams.get('root');
  const [includeCompleted, setIncludeCompleted] = useState(false);

  async function handleSignOut() {
    await signOutWithCleanup();
    router.push('/signin');
  }

  const handleNodeClick = (taskId: string) => {
    router.push(`/tasks/${taskId}`);
  };

  if (!rootTaskId) {
    return (
      <div className="flex h-full flex-col">
        <Header title="Task Dependencies" onSignOut={() => void handleSignOut()} />
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="border-outline-variant bg-surface-container rounded-xl border p-8 text-center">
            <h2 className="text-on-surface text-xl font-medium">No Task Selected</h2>
            <p className="text-on-surface-variant mt-2">
              Select a task to view its dependency graph.
            </p>
            <Button asChild className="mt-4">
              <Link href="/tasks">
                <ArrowBackIcon sx={{ fontSize: 18 }} className="mr-2" />
                Back to Tasks
              </Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <Header title="Task Dependencies" onSignOut={() => void handleSignOut()} />

      <div className="border-outline-variant flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-4">
          <Button variant="text" asChild>
            <Link href="/tasks">
              <ArrowBackIcon sx={{ fontSize: 18 }} className="mr-2" />
              Back to Tasks
            </Link>
          </Button>

          <Button
            variant="outlined"
            size="sm"
            onClick={() => {
              setIncludeCompleted(!includeCompleted);
            }}
          >
            {includeCompleted ? (
              <>
                <VisibilityOffIcon sx={{ fontSize: 18 }} className="mr-2" />
                Hide Completed
              </>
            ) : (
              <>
                <VisibilityIcon sx={{ fontSize: 18 }} className="mr-2" />
                Show Completed
              </>
            )}
          </Button>
        </div>

        <Button variant="text" asChild>
          <Link href={`/tasks/${rootTaskId}`}>
            <OpenInNewIcon sx={{ fontSize: 18 }} className="mr-2" />
            View Task
          </Link>
        </Button>
      </div>

      <div className="flex-1 p-6">
        <TaskDependencyFlow
          rootTaskId={rootTaskId}
          title="Dependency Graph"
          onNodeClick={handleNodeClick}
          includeCompleted={includeCompleted}
          className="h-full min-h-[500px]"
        />
      </div>
    </div>
  );
}
