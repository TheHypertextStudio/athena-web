'use client';

import {
  ESTIMATION_SCALE_LABEL,
  ESTIMATION_SCALES,
  type EstimationScale,
  type WorkspaceSettingsOut,
} from '@docket/types';
import { Field, Select, Skeleton } from '@docket/ui/primitives';
import { LoadFailure } from '@/components/settings/load-failure';
import { useTypedRoute } from '@/lib/app-location';
import { useEffect, useState, type JSX } from 'react';

import { SettingRowStatus } from '@/components/settings/setting-row-status';
import { useCanManageOrg } from '@/components/settings/use-can-manage-org';
import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import { apiQueryOptions, queryKeys, unwrap, useApiMutation, useLiveApiQuery } from '@/lib/query';
import { SettingsSectionPage } from '@/components/settings/settings-section-page';

/** The estimation scales offered, in picker order. */
const ESTIMATION_SCALE_ORDER: readonly EstimationScale[] = [
  'none',
  'exponential',
  'fibonacci',
  'linear',
  't_shirt',
];

/** Calendar month labels in the zero-based order stored by workspace settings. */
const MONTH_NAMES = Array.from({ length: 12 }, (_, month) =>
  new Intl.DateTimeFormat(undefined, { month: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2026, month, 1)),
  ),
);

/** The point values a scale offers, rendered as picker sub-copy (e.g. "1, 2, 4, 8, 16, 32"). */
function scaleValuesCopy(scale: EstimationScale): string | null {
  const options = ESTIMATION_SCALES[scale];
  return options.length > 0 ? options.map((o) => o.label).join(', ') : null;
}

/** Configure the maximum Initiative hierarchy depth for a workspace. */
export default function WorkStructureSettingsPage(): JSX.Element {
  const {
    params: { orgId },
  } = useTypedRoute('/orgs/[orgId]/settings/work-structure');
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
  const [autoCompleteParents, setAutoCompleteParents] = useState(true);
  const [scale, setScale] = useState<EstimationScale>('fibonacci');
  const [fiscalMonth, setFiscalMonth] = useState(0);
  useEffect(() => {
    if (settingsQ.data) {
      setDepth(settingsQ.data.initiativeMaxDepth);
      setAutoCompleteParents(settingsQ.data.autoCompleteParentTasks);
      setScale(settingsQ.data.estimationScale);
      setFiscalMonth(settingsQ.data.fiscalYearStartMonth);
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

  const saveParentCompletion = useApiMutation<WorkspaceSettingsOut, boolean>({
    mutationFn: (autoCompleteParentTasks) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].settings['work-structure'].$patch({
            param: { orgId },
            json: { autoCompleteParentTasks },
          }),
        'Could not save parent task completion.',
      ),
    onError: () => {
      setAutoCompleteParents(settingsQ.data?.autoCompleteParentTasks ?? true);
    },
    invalidateKeys: [key],
  });

  const saveFiscalMonth = useApiMutation<WorkspaceSettingsOut, number>({
    mutationFn: (fiscalYearStartMonth) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].settings['work-structure'].$patch({
            param: { orgId },
            json: { fiscalYearStartMonth },
          }),
        'Could not save the fiscal year start month.',
      ),
    invalidateKeys: [key],
  });

  return (
    <SettingsSectionPage
      title="Work structure"
      description="Set planning calendars, Initiative depth, parent task completion, and task estimates."
    >
      {/* placeholder: the workspace's configured initiative-nesting depth and estimation scale,
          and whether the caller is permitted to change them. The headings and explanations above
          are static copy. */}
      {settingsQ.isPending ? (
        <Skeleton className="h-96 max-w-2xl rounded-xl" />
      ) : settingsQ.isError ? (
        <LoadFailure
          message={userErrorMessage(settingsQ.error, 'Could not load work structure settings.')}
          retrying
        />
      ) : (
        <section aria-labelledby="initiative-depth" className="flex max-w-2xl flex-col gap-5">
          {!permissionLoading && !canManage ? (
            <p className="bg-surface-container text-on-surface-variant text-body-medium rounded-md px-3 py-2">
              Only workspace owners and admins can change this.
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
                className={`focus-visible:ring-ring text-label-large size-10 rounded-md focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${
                  depth === value
                    ? 'bg-secondary-container text-on-secondary-container'
                    : 'bg-surface-container text-on-surface hover:bg-surface-container-high'
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
            <h3 id="parent-completion" className="text-on-surface text-title-small">
              Complete parent tasks automatically
            </h3>
            <p className="text-on-surface-variant text-body-medium mt-1">
              When every subtask is complete or canceled, automatically complete its parent.
              Reopening a subtask reopens a parent that this setting completed.
            </p>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={autoCompleteParents}
            aria-label="Complete parent tasks automatically"
            disabled={permissionLoading || !canManage || saveParentCompletion.isPending}
            onClick={() => {
              const next = !autoCompleteParents;
              setAutoCompleteParents(next);
              if (next !== settingsQ.data.autoCompleteParentTasks) {
                saveParentCompletion.mutate(next);
              }
            }}
            className="text-on-surface hover:bg-surface-container-high text-body-medium focus-visible:ring-ring inline-flex w-fit items-center gap-2 rounded-md px-2 py-1.5 focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span
              aria-hidden="true"
              className={`inline-flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 transition-colors ${
                autoCompleteParents ? 'bg-primary justify-end' : 'bg-outline-variant'
              }`}
            >
              <span className="bg-surface h-3 w-3 rounded-full" />
            </span>
            {autoCompleteParents ? 'On' : 'Off'}
          </button>

          <SettingRowStatus
            pending={saveParentCompletion.isPending}
            saved={saveParentCompletion.isSuccess}
            error={
              saveParentCompletion.error
                ? userErrorMessage(
                    saveParentCompletion.error,
                    'Could not save parent task completion.',
                  )
                : null
            }
            idleLabel={autoCompleteParents ? 'On' : 'Off'}
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
                  className={`focus-visible:ring-ring flex flex-col items-start rounded-md px-3 py-2 text-left focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${
                    scale === value
                      ? 'bg-secondary-container text-on-secondary-container'
                      : 'bg-surface-container text-on-surface hover:bg-surface-container-high'
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

          <div>
            <h3 id="fiscal-calendar" className="text-on-surface text-title-small">
              Planning calendar
            </h3>
            <p className="text-on-surface-variant text-body-medium mt-1">
              This changes new Project and Initiative quarters, halves, and years. Saved timeframes
              do not move.
            </p>
          </div>

          <Field label="Fiscal year starts" className="max-w-xs">
            <Select
              aria-label="Fiscal year starts"
              value={String(fiscalMonth)}
              disabled={permissionLoading || !canManage || saveFiscalMonth.isPending}
              onChange={(event) => {
                const next = Number(event.target.value);
                setFiscalMonth(next);
                if (next !== settingsQ.data.fiscalYearStartMonth) {
                  saveFiscalMonth.mutate(next);
                }
              }}
            >
              {MONTH_NAMES.map((name, month) => (
                <option key={name} value={month}>
                  {name}
                </option>
              ))}
            </Select>
          </Field>

          <SettingRowStatus
            pending={saveFiscalMonth.isPending}
            saved={saveFiscalMonth.isSuccess}
            error={
              saveFiscalMonth.error
                ? userErrorMessage(
                    saveFiscalMonth.error,
                    'Could not save the fiscal year start month.',
                  )
                : null
            }
            idleLabel={`Current start: ${MONTH_NAMES[settingsQ.data.fiscalYearStartMonth] ?? 'January'}`}
          />
        </section>
      )}
    </SettingsSectionPage>
  );
}
