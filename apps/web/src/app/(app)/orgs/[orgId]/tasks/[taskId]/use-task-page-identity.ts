'use client';

/** Keep the tab title, browser title, and Athena's page context aligned with this task's name. */
import { usePublishPageSource } from '@/components/athena/page-context';
import { useDocumentTitle } from '@/components/tabs/use-document-title';
import { useRegisterTabTitle } from '@/components/tabs/use-register-tab-title';

/** Register this task's tab title, browser title, and Athena page-context source together. */
export function useTaskPageIdentity(
  orgId: string,
  taskId: string,
  title: string | undefined,
): void {
  useRegisterTabTitle('task', orgId, taskId, title);
  useDocumentTitle(title);
  usePublishPageSource({ type: 'task', id: taskId, ...(title ? { label: title } : {}) });
}
