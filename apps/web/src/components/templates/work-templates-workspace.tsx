'use client';
import type { JSX } from 'react';
import { QueryLoadFailure } from '@/components/feedback';
import { useApiListQuery } from '@/lib/query';
import { WorkTemplateLibrary } from './gallery/work-template-library';
import { workTemplatesDef } from './work-template-queries';
import { WorkTemplateWorkspaceFrame } from './work-template-workspace-frame';

/** Define and reuse organizational work in a dedicated workspace, separate from administration. */
export function WorkTemplatesWorkspace({ orgId }: { readonly orgId: string }): JSX.Element {
  const query = useApiListQuery(
    workTemplatesDef(orgId, { includeDrafts: true, includeArchived: true }),
  );
  return (
    <WorkTemplateWorkspaceFrame
      orgId={orgId}
      title="Work templates"
      description="Define the kinds of work your workspace does and what each includes."
      loading={query.isPending}
    >
      {query.isError ? (
        <QueryLoadFailure title="Work templates" query={query} />
      ) : (
        <WorkTemplateLibrary orgId={orgId} items={query.data?.items ?? []} />
      )}
    </WorkTemplateWorkspaceFrame>
  );
}
