'use client';

/** Keep the tab title, browser title, and Athena's page context aligned with this project's name. */
import { usePublishPageSource } from '@/components/athena/page-context';
import { useDocumentTitle } from '@/components/tabs/use-document-title';
import { useRegisterTabTitle } from '@/components/tabs/use-register-tab-title';

/** Register this project's tab title, browser title, and Athena page-context source together. */
export function useProjectPageIdentity(
  orgId: string,
  projectId: string,
  title: string | undefined,
): void {
  useRegisterTabTitle('project', orgId, projectId, title);
  useDocumentTitle(title);
  usePublishPageSource({ type: 'project', id: projectId, ...(title ? { label: title } : {}) });
}
