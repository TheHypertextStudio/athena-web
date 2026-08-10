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
import { SettingRowStatus } from '@/components/settings/setting-row-status';
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
        <p role="status" className="text-on-surface-variant text-body-medium">
          Work structure is temporarily unavailable. We&apos;ll keep checking automatically.
        </p>
      ) : (
        <section aria-labelledby="initiative-depth" className="flex max-w-2xl flex-col gap-5">
          {!permissionLoading && !canManage ? (
            <p className="bg-surface-container text-on-surface-variant text-body-medium rounded-md px-3 py-2">
              Only workspace owners and admins can change this limit.
            </p>
          ) : null}
          <div>
            <h3 id="initiative-depth" className="text-on-surface text-title-small">
              Initiative hierarchy depth
            </h3>
            <p className="text-on-surface-variant text-body-medium mt-1">
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
                className={`focus-visible:ring-ring text-label-large size-10 rounded-md border focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${
                  depth === value
                    ? 'border-primary bg-primary text-on-primary'
                    : 'border-outline-variant text-on-surface hover:bg-surface-container'
                }`}
              >
                {value}
              </button>
            ))}
          </fieldset>

          <SettingRowStatus
            pending={saveDepth.isPending}
            saved={saveDepth.isSuccess}
            error={
              saveDepth.error
                ? userErrorMessage(saveDepth.error, 'Could not save work structure settings.')
                : null
            }
            idleLabel={`Current maximum: ${settingsQ.data.initiativeMaxDepth}`}
          />

          <div>
            <h3 id="estimation-scale" className="text-on-surface text-title-small">
              Estimation scale
            </h3>
            <p className="text-on-surface-variant text-body-medium mt-1">
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
                  <span className="text-label-large">{ESTIMATION_SCALE_LABEL[value]}</span>
                  {valuesCopy ? (
                    <span
                      className={`text-label-medium ${scale === value ? 'text-on-primary/80' : 'text-on-surface-variant'}`}
                    >
                      {valuesCopy}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </fieldset>

          <SettingRowStatus
            pending={saveScale.isPending}
            saved={saveScale.isSuccess}
            error={
              saveScale.error
                ? userErrorMessage(saveScale.error, 'Could not save the estimation scale.')
                : null
            }
            idleLabel={`Current scale: ${ESTIMATION_SCALE_LABEL[settingsQ.data.estimationScale]}`}
          />
        </section>
      )}
    </div>
  );
}
