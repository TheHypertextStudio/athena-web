'use client';

import {
  ESTIMATION_SCALE_LABEL,
  ESTIMATION_SCALES,
  type EstimationScale,
  type WorkspaceSettingsOut,
} from '@docket/types';
import { Skeleton } from '@docket/ui/primitives';
import { useAppParams } from '@/lib/app-location';
import { useEffect, useState, type JSX } from 'react';

import { SectionHeader } from '@/components/settings/section-header';
import { useCanManageOrg } from '@/components/settings/use-can-manage-org';
import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import { apiQueryOptions, queryKeys, unwrap, useApiMutation, useLiveApiQuery } from '@/lib/query';

/** The estimation scales offered, in picker order. */
const ESTIMATION_SCALE_ORDER: readonly EstimationScale[] = [
  'none',
  'exponential',
  'fibonacci',
  'linear',
  't_shirt',
];

/** The point values a scale offers, rendered as picker sub-copy (e.g. "1, 2, 4, 8, 16, 32"). */
function scaleValuesCopy(scale: EstimationScale): string | null {
  const options = ESTIMATION_SCALES[scale];
  return options.length > 0 ? options.map((o) => o.label).join(', ') : null;
}

/** Props for {@link AutosaveStatus}. */
interface AutosaveStatusProps {
  pending: boolean;
  error: unknown;
  errorFallback: string;
  success: boolean;
  /** What to show once settled with no unsaved change in flight (e.g. "Current maximum: 2"). */
  idleLabel: string;
}

/** The shared saving/error/saved/idle status line under an autosaving settings control. */
function AutosaveStatus({
  pending,
  error,
  errorFallback,
  success,
  idleLabel,
}: AutosaveStatusProps): JSX.Element {
  return (
    <div className="flex min-h-5 items-center gap-2 text-xs" aria-live="polite">
      {pending ? (
        <span className="text-on-surface-variant">Saving…</span>
      ) : error ? (
        <span role="alert" className="text-error">
          {userErrorMessage(error, errorFallback)}
        </span>
      ) : success ? (
        <span className="text-on-surface-variant">Saved</span>
      ) : (
        <span className="text-on-surface-variant">{idleLabel}</span>
      )}
    </div>
  );
}

/** Configure the maximum Initiative hierarchy depth for a workspace. */
export default function WorkStructureSettingsPage(): JSX.Element {
  const { orgId } = useAppParams<{ orgId: string }>();
  const { canManage, loading: permissionLoading } = useCanManageOrg(orgId);
  const key = queryKeys.settings(orgId, 'work-structure');
  const settingsQ = useLiveApiQuery(
    apiQueryOptions(
      key,
      () =>
        api.v1.orgs[':orgId'].settings['work-structure'].$get({
          param: { orgId },
        }),
      'Could not load work structure settings.',
    ),
    15_000,
  );
  const [depth, setDepth] = useState(2);
  const [scale, setScale] = useState<EstimationScale>('fibonacci');
  useEffect(() => {
    if (settingsQ.data) {
      setDepth(settingsQ.data.initiativeMaxDepth);
      setScale(settingsQ.data.estimationScale);
    }
  }, [settingsQ.data]);

  const saveDepth = useApiMutation<WorkspaceSettingsOut, number>({
    mutationFn: (initiativeMaxDepth) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].settings['work-structure'].$patch({
            param: { orgId },
            json: { initiativeMaxDepth },
          }),
        'Could not save work structure settings.',
      ),
    invalidateKeys: [key, queryKeys.initiatives(orgId)],
  });

  const saveScale = useApiMutation<WorkspaceSettingsOut, EstimationScale>({
    mutationFn: (estimationScale) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].settings['work-structure'].$patch({
            param: { orgId },
            json: { estimationScale },
          }),
        'Could not save the estimation scale.',
      ),
    invalidateKeys: [key],
  });

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Work structure"
        description="Keep initiatives strategic by limiting how deeply they can be nested, and choose how the team sizes work."
      />

      {/* placeholder: the workspace's configured initiative-nesting depth and estimation scale,
          and whether the caller is permitted to change them. The headings and explanations above
          are static copy. */}
      {settingsQ.isPending ? (
        <Skeleton className="h-96 max-w-2xl rounded-lg" />
      ) : settingsQ.isError ? (
        <p role="status" className="text-on-surface-variant text-sm">
          Work structure is temporarily unavailable. We&apos;ll keep checking automatically.
        </p>
      ) : (
        <section aria-labelledby="initiative-depth" className="flex max-w-2xl flex-col gap-5">
          {!permissionLoading && !canManage ? (
            <p className="bg-surface-container text-on-surface-variant rounded-md px-3 py-2 text-sm">
              Only workspace owners and admins can change this limit.
            </p>
          ) : null}
          <div>
            <h3 id="initiative-depth" className="text-on-surface text-sm font-semibold">
              Initiative hierarchy depth
            </h3>
            <p className="text-on-surface-variant mt-1 text-sm leading-relaxed">
              Depth counts every level. Two levels means one top-level initiative and one level of
              sub-initiatives.
            </p>
          </div>

          <fieldset className="flex gap-2" aria-label="Maximum Initiative depth">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={depth === value}
                disabled={permissionLoading || !canManage || saveDepth.isPending}
                onClick={() => {
                  setDepth(value);
                  // Autosave immediately, but only when the choice actually differs from
                  // what's persisted — never re-save an unchanged value.
                  if (value !== settingsQ.data.initiativeMaxDepth) {
                    saveDepth.mutate(value);
                  }
                }}
                className={`focus-visible:ring-ring size-10 rounded-md border text-sm font-medium focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${
                  depth === value
                    ? 'border-primary bg-primary text-on-primary'
                    : 'border-outline-variant text-on-surface hover:bg-surface-container'
                }`}
              >
                {value}
              </button>
            ))}
          </fieldset>

          <AutosaveStatus
            pending={saveDepth.isPending}
            error={saveDepth.error}
            errorFallback="Could not save work structure settings."
            success={saveDepth.isSuccess}
            idleLabel={`Current maximum: ${settingsQ.data.initiativeMaxDepth}`}
          />

          <div>
            <h3 id="estimation-scale" className="text-on-surface text-sm font-semibold">
              Estimation scale
            </h3>
            <p className="text-on-surface-variant mt-1 text-sm leading-relaxed">
              The set of point values shown when estimating a task&apos;s size.
            </p>
          </div>

          <fieldset
            className="flex flex-col gap-2"
            aria-label="Estimation scale"
            aria-labelledby="estimation-scale"
          >
            {ESTIMATION_SCALE_ORDER.map((value) => {
              const valuesCopy = scaleValuesCopy(value);
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={scale === value}
                  disabled={permissionLoading || !canManage || saveScale.isPending}
                  onClick={() => {
                    setScale(value);
                    if (value !== settingsQ.data.estimationScale) {
                      saveScale.mutate(value);
                    }
                  }}
                  className={`focus-visible:ring-ring flex flex-col items-start rounded-md border px-3 py-2 text-left focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${
                    scale === value
                      ? 'border-primary bg-primary text-on-primary'
                      : 'border-outline-variant text-on-surface hover:bg-surface-container'
                  }`}
                >
                  <span className="text-sm font-medium">{ESTIMATION_SCALE_LABEL[value]}</span>
                  {valuesCopy ? (
                    <span
                      className={`text-xs ${scale === value ? 'text-on-primary/80' : 'text-on-surface-variant'}`}
                    >
                      {valuesCopy}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </fieldset>

          <AutosaveStatus
            pending={saveScale.isPending}
            error={saveScale.error}
            errorFallback="Could not save the estimation scale."
            success={saveScale.isSuccess}
            idleLabel={`Current scale: ${ESTIMATION_SCALE_LABEL[settingsQ.data.estimationScale]}`}
          />
        </section>
      )}
    </div>
  );
}
