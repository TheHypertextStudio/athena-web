import type { JSX } from 'react';

import { TaskDetailLoading } from '@/components/task-detail/task-detail-loading';

/** Render the Task layout while Next loads the detail route. */
export default function LoadingTaskDetail(): JSX.Element {
  return <TaskDetailLoading />;
}
