'use client';

import type { WorkspaceSettingsOut } from '@docket/types';
import { Skeleton } from '@docket/ui/primitives';
import { use, useEffect, useState, type JSX } from 'react';

import { SectionHeader } from '@/components/settings/section-header';
import { useCanManageOrg } from '@/components/settings/use-can-manage-org';
import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import { apiQueryOptions, queryKeys, unwrap, useApiMutation, useLiveApiQuery } from '@/lib/query';

/** Configure the maximum Initiative hierarchy depth for a workspace. */
export default function WorkStructureSettingsPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}): JSX.Element {
  const { orgId } = use(params);
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
  useEffect(() => {
    if (settingsQ.data) setDepth(settingsQ.data.initiativeMaxDepth);
  }, [settingsQ.data]);

  const save = useApiMutation<WorkspaceSettingsOut, number>({
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

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Work structure"
        description="Keep initiatives strategic by limiting how deeply they can be nested."
      />

      {settingsQ.isPending ? (
        <Skeleton className="h-44 max-w-2xl rounded-lg" />
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
                disabled={permissionLoading || !canManage || save.isPending}
                onClick={() => {
                  setDepth(value);
                  // Autosave immediately, but only when the choice actually differs from
                  // what's persisted — never re-save an unchanged value.
                  if (value !== settingsQ.data.initiativeMaxDepth) {
                    save.mutate(value);
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

          <div className="flex min-h-5 items-center gap-2 text-xs" aria-live="polite">
            {save.isPending ? (
              <span className="text-on-surface-variant">Saving…</span>
            ) : save.error ? (
              <span role="alert" className="text-destructive">
                {userErrorMessage(save.error, 'Could not save work structure settings.')}
              </span>
            ) : save.isSuccess ? (
              <span className="text-on-surface-variant">Saved</span>
            ) : (
              <span className="text-on-surface-variant">
                Current maximum: {settingsQ.data.initiativeMaxDepth}
              </span>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
