'use client';
import { useEffect, useState } from 'react';
import {
  WorkTemplateSourceCopyPreview,
  type WorkTemplateSourceCopyPreviewRequest,
} from '@docket/work/template-copy';
import { userErrorMessage } from '@/lib/problem';
import { useTemplateSourceCopyPreview } from '../work-template-source-copy-queries';

/** Exact current checked choices; private definition bodies remain only in query/component memory. */
export interface SourceCheckedReview {
  readonly key: string;
  readonly request: WorkTemplateSourceCopyPreviewRequest;
  readonly preview: WorkTemplateSourceCopyPreview;
}
/** Read-only union-source preview with stale-response exclusion and explicit retry. */
export function useSourceCopyReview(
  orgId: string,
  request: WorkTemplateSourceCopyPreviewRequest,
  enabled: boolean,
) {
  const { mutateAsync } = useTemplateSourceCopyPreview(orgId);
  const [checked, setChecked] = useState<SourceCheckedReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settled, setSettled] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const key = JSON.stringify([orgId, request, revision]);
  useEffect(() => {
    let current = true;
    if (!enabled) return;
    setError(null);
    void mutateAsync(request)
      .then((value) => {
        if (current)
          setChecked({ key, request, preview: WorkTemplateSourceCopyPreview.parse(value) });
      })
      .catch((failure: unknown) => {
        if (current)
          setError(
            userErrorMessage(failure, 'Could not review this copy. Your choices are still here.'),
          );
      })
      .finally(() => {
        if (current) setSettled(key);
      });
    return () => {
      current = false;
    };
  }, [key, enabled, mutateAsync]);
  return {
    checked: checked?.key === key ? checked : null,
    updating: enabled && settled !== key,
    error,
    refresh: () => {
      setRevision((value) => value + 1);
    },
  };
}
