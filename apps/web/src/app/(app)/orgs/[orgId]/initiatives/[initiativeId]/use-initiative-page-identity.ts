'use client';

/** Keep the tab title, browser title, and Athena's page context aligned with this initiative's name. */
import { usePublishPageSource } from '@/components/athena/page-context';
import { useDocumentTitle } from '@/components/tabs/use-document-title';
import { useRegisterTabTitle } from '@/components/tabs/use-register-tab-title';

/** Register this initiative's tab title, browser title, and Athena page-context source together. */
export function useInitiativePageIdentity(
  orgId: string,
  initiativeId: string,
  title: string | undefined,
): void {
  useRegisterTabTitle('initiative', orgId, initiativeId, title);
  useDocumentTitle(title);
  usePublishPageSource({
    type: 'initiative',
    id: initiativeId,
    ...(title ? { label: title } : {}),
  });
}
