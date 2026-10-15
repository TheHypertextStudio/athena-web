'use client';
import type { JSX } from 'react';
import type { WorkScheduleUsedTemplate } from '@docket/work/work-schedule-management';
import { Button } from '@docket/ui/primitives';
import { useApiQuery } from '@/lib/query';
import { workTemplateIdentityDef } from '@/components/templates/work-template-identity-queries';

/** Read the server-selected exact retained publication; never infer it from the current latest version. */
export function useScheduleRetainedIdentity(
  orgId: string,
  retained: WorkScheduleUsedTemplate | null | undefined,
) {
  return useApiQuery(
    workTemplateIdentityDef(orgId, retained?.workTypeId, retained?.workTypeVersionId),
  );
}
/** The authorized exact publication used for archive continuity, with a recoverable read failure. */
export function ScheduleRetainedIdentity({
  orgId,
  retained,
}: {
  readonly orgId: string;
  readonly retained: WorkScheduleUsedTemplate;
}): JSX.Element {
  const identity = useScheduleRetainedIdentity(orgId, retained);
  if (identity.isError)
    return (
      <Button variant="ghost" size="sm" onClick={() => void identity.refetch()}>
        Saved template version unavailable · Retry
      </Button>
    );
  return (
    <p className="text-body-medium text-on-surface-variant break-words">
      {identity.data
        ? `${identity.data.name} · Version ${identity.data.versionNumber} · Archived`
        : 'Loading saved template version…'}
    </p>
  );
}
