'use client';

import type { AthenaApprovalMode, HubPreferences } from '@docket/types';
import { Button, Skeleton } from '@docket/ui/primitives';
import { useEffect, useState, type JSX } from 'react';

import { McpConnectorsSection } from '@/components/settings/mcp-connectors-section';
import { SectionHeader } from '@/components/settings/section-header';
import { useCanManageOrg } from '@/components/settings/use-can-manage-org';
import { usePersonalWorkspaceId } from '@/components/settings/use-personal-workspace-id';
import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import { apiQueryOptions, queryKeys, unwrap, useApiMutation, useLiveApiQuery } from '@/lib/query';

/** The user-owned Athena preferences destination. */
export default function GlobalAthenaSettingsPage(): JSX.Element {
  const orgId = usePersonalWorkspaceId();
  const { canManage } = useCanManageOrg(orgId ?? '');
  const [instructions, setInstructions] = useState('');
  const [approvalMode, setApprovalMode] = useState<AthenaApprovalMode>('ask_before_acting');
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const preferencesQ = useLiveApiQuery(
    apiQueryOptions(
      queryKeys.hubPreferences(),
      () => api.v1.hub.preferences.$get(),
      'Could not load Athena preferences.',
    ),
    15_000,
  );

  useEffect(() => {
    if (!preferencesQ.data) return;
    const nextInstructions = preferencesQ.data.athena?.instructions ?? '';
    const nextApproval = preferencesQ.data.athena?.approvalMode ?? 'ask_before_acting';
    if (editing) {
      if (instructions === nextInstructions && approvalMode === nextApproval) {
        setEditing(false);
      }
      return;
    }
    setInstructions(nextInstructions);
    setApprovalMode(nextApproval);
  }, [approvalMode, editing, instructions, preferencesQ.data]);

  const save = useApiMutation<HubPreferences, HubPreferences>({
    mutationFn: (json) =>
      unwrap(() => api.v1.hub.preferences.$patch({ json }), 'Could not save Athena preferences.'),
    invalidateKeys: [queryKeys.hubPreferences()],
    onSuccess: (preferences) => {
      setInstructions(preferences.athena?.instructions ?? '');
      setApprovalMode(preferences.athena?.approvalMode ?? 'ask_before_acting');
      setEditing(false);
      setSaved(true);
    },
  });

  const currentInstructions = preferencesQ.data?.athena?.instructions ?? '';
  const currentApproval = preferencesQ.data?.athena?.approvalMode ?? 'ask_before_acting';
  const changed = instructions !== currentInstructions || approvalMode !== currentApproval;

  function savePreferences(): void {
    save.mutate({
      athena: { instructions: instructions.trim(), approvalMode },
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title="Athena" description="Set how your chief of staff works with you." />
      {preferencesQ.isPending ? (
        <Skeleton className="h-[30rem] max-w-2xl rounded-lg" />
      ) : preferencesQ.isError ? (
        <p role="status" className="text-on-surface-variant text-sm">
          Athena preferences are temporarily unavailable. We&apos;ll keep checking automatically.
        </p>
      ) : (
        <section className="bg-surface-container-low flex max-w-2xl flex-col gap-5 rounded-lg p-5">
          <div>
            <h2 className="text-on-surface text-sm font-semibold">Working preferences</h2>
            <p className="text-on-surface-variant mt-1 text-sm">
              Give Athena durable guidance for how to represent you across Docket and your connected
              services.
            </p>
          </div>
          <label className="text-on-surface flex flex-col gap-1.5 text-sm font-medium">
            Instructions for Athena
            <textarea
              value={instructions}
              disabled={save.isPending}
              onChange={(event) => {
                setInstructions(event.target.value);
                setEditing(true);
                setSaved(false);
              }}
              rows={5}
              placeholder="For example: keep updates concise and flag anything that needs my approval."
              className="border-outline-variant bg-surface text-on-surface placeholder:text-on-surface-variant focus-visible:ring-ring w-full resize-y rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>
          <label className="text-on-surface flex max-w-md flex-col gap-1.5 text-sm font-medium">
            Approval behavior
            <select
              value={approvalMode}
              disabled={save.isPending}
              onChange={(event) => {
                setApprovalMode(event.target.value as AthenaApprovalMode);
                setEditing(true);
                setSaved(false);
              }}
              className="border-outline-variant bg-surface text-on-surface focus-visible:ring-ring h-10 rounded-md border px-3 text-sm outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="ask_before_acting">Ask before acting</option>
              <option value="routine_autonomy">Act on routine work</option>
              <option value="suggest_only">Suggest only</option>
            </select>
          </label>
          {save.error ? (
            <p role="alert" className="text-destructive text-sm">
              {userErrorMessage(save.error, 'Could not save Athena preferences.')}
            </p>
          ) : null}
          <div className="flex items-center gap-3">
            <Button
              type="button"
              disabled={!changed || save.isPending || saved}
              onClick={savePreferences}
            >
              {save.isPending ? 'Saving…' : 'Save Athena preferences'}
            </Button>
            {saved ? (
              <span className="text-on-surface-variant text-xs" role="status">
                Athena preferences saved.
              </span>
            ) : null}
          </div>
        </section>
      )}
      {orgId ? <McpConnectorsSection orgId={orgId} canManage={canManage} /> : null}
    </div>
  );
}
