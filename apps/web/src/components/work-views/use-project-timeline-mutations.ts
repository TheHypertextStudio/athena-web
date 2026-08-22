'use client';

import type { ProjectOut } from '@docket/types';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import type { ScheduleChange } from '@/components/timeline/cascade';
import type { TimelineSpan } from '@/components/timeline/timeline-catalog';
import { api } from '@/lib/api';
import { unwrap, useApiMutation } from '@/lib/query';

function toWireDate(milliseconds: number): string {
  return new Date(milliseconds).toISOString().slice(0, 10);
}

/** Project timeline write callbacks and their shared pending and error state. */
export interface ProjectTimelineMutations {
  readonly applyingCascade: boolean;
  readonly error: unknown;
  readonly reschedule: (projectId: string, span: TimelineSpan) => void;
  readonly applyCascade: (changes: readonly ScheduleChange[]) => void;
}

/** Persist Project timeline drags and downstream cascade proposals. */
export function useProjectTimelineMutations(organizationId: string): ProjectTimelineMutations {
  const queryClient = useQueryClient();
  const [applyingCascade, setApplyingCascade] = useState(false);
  const [cascadeError, setCascadeError] = useState<unknown>(null);
  const invalidateKeys = [
    ['org', organizationId, 'work-view'],
    ['org', organizationId, 'projects', 'overview'],
  ] as const;
  const rescheduleMutation = useApiMutation<
    ProjectOut,
    { readonly projectId: string; readonly span: TimelineSpan }
  >({
    mutationFn: ({ projectId, span }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].projects[':id'].$patch({
            param: { orgId: organizationId, id: projectId },
            json: {
              startDate: toWireDate(span.start),
              startDateResolution: null,
              targetDate: toWireDate(span.end),
              targetDateResolution: null,
            },
          }),
        'Could not reschedule this project.',
      ),
    invalidateKeys,
  });

  const applyCascade = useCallback(
    (changes: readonly ScheduleChange[]): void => {
      if (changes.length === 0 || applyingCascade) return;
      setApplyingCascade(true);
      setCascadeError(null);
      void Promise.all(
        changes.map((change) =>
          unwrap(
            () =>
              api.v1.orgs[':orgId'].projects[':id'].$patch({
                param: { orgId: organizationId, id: change.id },
                json: {
                  startDate: toWireDate(change.to.start),
                  startDateResolution: null,
                  targetDate: toWireDate(change.to.end),
                  targetDateResolution: null,
                },
              }),
            'Could not reschedule a dependent project.',
          ),
        ),
      )
        .catch((error: unknown) => {
          setCascadeError(error);
        })
        .finally(() => {
          setApplyingCascade(false);
          void queryClient.invalidateQueries({ queryKey: ['org', organizationId, 'work-view'] });
          void queryClient.invalidateQueries({
            queryKey: ['org', organizationId, 'projects', 'overview'],
          });
        });
    },
    [applyingCascade, organizationId, queryClient],
  );

  return {
    applyingCascade,
    error: rescheduleMutation.error ?? cascadeError,
    reschedule: (projectId: string, span: TimelineSpan): void => {
      rescheduleMutation.mutate({ projectId, span });
    },
    applyCascade,
  };
}
