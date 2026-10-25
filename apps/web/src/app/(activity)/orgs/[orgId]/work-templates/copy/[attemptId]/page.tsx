'use client';
import type { JSX } from 'react';
import { useTypedRoute } from '@/lib/app-location';
import { SourceCopyWorkspace } from '@/components/templates/source-copy/source-copy-workspace';

/** Copy an explicitly selected saved source through the focused canonical copy review. */
export default function SourceCopyPage(): JSX.Element {
  const {
    params: { orgId, attemptId },
  } = useTypedRoute('/orgs/[orgId]/work-templates/copy/[attemptId]');
  return <SourceCopyWorkspace orgId={orgId} attemptId={attemptId} />;
}
