'use client';

import type { ProjectOut } from '../../lib/contracts/project';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import type { ScheduleChange } from '@/components/timeline/cascade';
import type { TimelineSpan } from '@/components/timeline/timeline-catalog';
import { api } from '@/lib/api';
import { unwrap, useApiMutation } from '@/lib/query';
import { invalidateWorkTargetQueries } from '@/lib/work-target-invalidation';

function toWireDate(milliseconds: number): string {
  return new Date(milliseconds).toISOString().slice(0, 10);
}

/** One Project row and the organization that owns its timeline write. */
export interface ProjectTimelineSubject {
  readonly id: string;
  readonly organizationId: string;
}

/** One cascade change with the owning organization required by the Project API. */
export interface ProjectTimelineScheduleChange extends ScheduleChange {
  readonly organizationId: string;
}

/** Project timeline write callbacks and their shared pending and error state. */
export interface ProjectTimelineMutations {
  readonly applyingCascade: boolean;
  readonly pending: boolean;
  readonly error: unknown;
  readonly reschedule: (project: ProjectTimelineSubject, span: TimelineSpan) => void;
  readonly applyCascade: (changes: readonly ProjectTimelineScheduleChange[]) => void;
}

/** Persist Project timeline drags and downstream cascade proposals. */
export function useProjectTimelineMutations(): ProjectTimelineMutations {
  const queryClient = useQueryClient();
  const [applyingCascade, setApplyingCascade] = useState(false);
  const [cascadeError, setCascadeError] = useState<unknown>(null);
  const rescheduleMutation = useApiMutation<
    ProjectOut,
    { readonly project: ProjectTimelineSubject; readonly span: TimelineSpan }
  >({
    mutationFn: ({ project, span }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].projects[':id'].$patch({
            param: { orgId: project.organizationId, id: project.id },
            json: {
              startDate: toWireDate(span.start),
              startDateResolution: null,
              targetDate: toWireDate(span.end),
              targetDateResolution: null,
            },
          }),
        'Could not reschedule this project.',
      ),
    onSettled: (_data, _error, input) => {
      void invalidateWorkTargetQueries(queryClient, {
        target: 'project',
        ownerOrganizationId: input.project.organizationId,
      });
    },
  });

  const applyCascade = useCallback(
    (changes: readonly ProjectTimelineScheduleChange[]): void => {
      if (changes.length === 0 || applyingCascade) return;
      setApplyingCascade(true);
      setCascadeError(null);
      void Promise.allSettled(
        changes.map((change) =>
          unwrap(
            () =>
              api.v1.orgs[':orgId'].projects[':id'].$patch({
                param: { orgId: change.organizationId, id: change.id },
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
        .then((results) => {
          const firstFailure = results.find((result) => result.status === 'rejected');
          if (firstFailure?.status === 'rejected') {
            setCascadeError(firstFailure.reason);
          }
        })
        .finally(() => {
          for (const ownerOrganizationId of new Set(
            changes.map((change) => change.organizationId),
          )) {
            void invalidateWorkTargetQueries(queryClient, {
              target: 'project',
              ownerOrganizationId,
            });
          }
          setApplyingCascade(false);
        });
    },
    [applyingCascade, queryClient],
  );

  return {
    applyingCascade,
    pending: rescheduleMutation.isPending,
    error: rescheduleMutation.error ?? cascadeError,
    reschedule: (project: ProjectTimelineSubject, span: TimelineSpan): void => {
      rescheduleMutation.mutate({ project, span });
    },
    applyCascade,
  };
}
