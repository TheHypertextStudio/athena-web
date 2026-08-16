'use client';

import type { AthenaApprovalMode, HubPreferences } from '@docket/types';
import { Select, Textarea } from '@docket/ui/primitives';
import { useEffect, useRef, useState, type JSX } from 'react';

import { McpConnectorsSection } from '@/components/settings/mcp-connectors-section';
import { useCanManageOrg } from '@/components/settings/use-can-manage-org';
import { usePersonalWorkspaceId } from '@/components/settings/use-personal-workspace-id';
import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import { apiQueryOptions, queryKeys, unwrap, useApiMutation, useLiveApiQuery } from '@/lib/query';

import { VoicePhoneNumbers } from '@/components/athena/voice-phone-numbers';

import { LatticeSection } from './lattice-section';
import { LoadFailure } from '@/components/settings/load-failure';
import { SettingsGroup } from '@/components/settings/settings-group';
import { SettingsSectionPage } from '@/components/settings/settings-section-page';

/** The user-owned Athena preferences destination. */
export default function GlobalAthenaSettingsPage(): JSX.Element {
  const orgId = usePersonalWorkspaceId();
  const { canManage } = useCanManageOrg(orgId ?? '');
  const [instructions, setInstructions] = useState('');
  const [approvalMode, setApprovalMode] = useState<AthenaApprovalMode>('ask_before_acting');
  const preferencesQ = useLiveApiQuery(
    apiQueryOptions(
      queryKeys.hubPreferences(),
      () => api.v1.hub.preferences.$get(),
      'Could not load Athena preferences.',
    ),
    15_000,
  );

  const persistedInstructions = preferencesQ.data?.athena?.instructions ?? '';
  const persistedApproval = preferencesQ.data?.athena?.approvalMode ?? 'ask_before_acting';

  const save = useApiMutation<HubPreferences, HubPreferences>({
    mutationFn: (json) =>
      unwrap(() => api.v1.hub.preferences.$patch({ json }), 'Could not save Athena preferences.'),
    invalidateKeys: [queryKeys.hubPreferences()],
  });

  // Read the live drafts at reconcile time without making the effect re-run on every keystroke.
  const instructionsRef = useRef(instructions);
  instructionsRef.current = instructions;
  const approvalRef = useRef(approvalMode);
  approvalRef.current = approvalMode;
  // The server values we last mirrored into each field; `null` until the first load seeds them.
  const syncedInstructionsRef = useRef<string | null>(null);
  const syncedApprovalRef = useRef<AthenaApprovalMode | null>(null);

  // Mirror persisted values into the editable fields on the initial load and whenever the server
  // value genuinely changes — but only while the field still holds what we last showed from the
  // server. A local edit that diverged (a save in flight, or one that just failed) is preserved
  // rather than clobbered with the stale persisted value. This also removes the old→new flicker on
  // the success path: the typed value already differs from the pre-refetch persisted value, so we
  // skip re-seeding it. Keyed on server data only — never on `save.isPending`, whose true→false
  // flip on a failed save was what discarded the user's text.
  useEffect(() => {
    if (!preferencesQ.data) return;
    if (
      syncedInstructionsRef.current === null ||
      instructionsRef.current === syncedInstructionsRef.current
    ) {
      setInstructions(persistedInstructions);
    }
    syncedInstructionsRef.current = persistedInstructions;
    if (syncedApprovalRef.current === null || approvalRef.current === syncedApprovalRef.current) {
      setApprovalMode(persistedApproval);
    }
    syncedApprovalRef.current = persistedApproval;
  }, [persistedApproval, persistedInstructions, preferencesQ.data]);

  /** Persist the whole Athena preference slice — the same PATCH the Save button used to fire. */
  function persist(next: { instructions: string; approvalMode: AthenaApprovalMode }): void {
    save.mutate({
      athena: { instructions: next.instructions.trim(), approvalMode: next.approvalMode },
    });
  }

  return (
    <SettingsSectionPage
      sectionKey="athena"
      // placeholder: the caller's saved Athena preferences — their standing instructions and the
      // approval mode. Both are free-form values only the stored record knows; the section heading
      // and description render immediately.
      loading={preferencesQ.isPending}
    >
      {preferencesQ.isError ? (
        <LoadFailure
          message={userErrorMessage(preferencesQ.error, 'Could not load Athena preferences.')}
          retrying
        />
      ) : (
        <SettingsGroup
          title="Working preferences"
          description="Give Athena durable guidance for how to represent you across Docket and your connected services."
        >
          <label className="text-on-surface text-label-large flex flex-col gap-1.5">
            Instructions for Athena
            <Textarea
              value={instructions}
              onChange={(event) => {
                setInstructions(event.target.value);
              }}
              onBlur={() => {
                if (instructions.trim() !== persistedInstructions) {
                  persist({ instructions, approvalMode });
                }
              }}
              rows={5}
              placeholder="For example: keep updates concise and flag anything that needs my approval."
              className="w-full resize-y"
            />
          </label>
          <label className="text-on-surface text-label-large flex flex-col gap-1.5">
            Approval behavior
            <Select
              value={approvalMode}
              onChange={(event) => {
                const next = event.target.value as AthenaApprovalMode;
                setApprovalMode(next);
                if (next !== persistedApproval) {
                  persist({ instructions, approvalMode: next });
                }
              }}
            >
              <option value="ask_before_acting">Ask before acting</option>
              <option value="routine_autonomy">Act on routine work</option>
              <option value="suggest_only">Suggest only</option>
            </Select>
          </label>
          {save.isError ? (
            <p role="alert" className="text-error text-body-medium">
              {userErrorMessage(save.error, 'Could not save Athena preferences.')}
            </p>
          ) : (
            <p
              role="status"
              aria-live="polite"
              className="text-on-surface-variant text-body-small h-4"
            >
              {save.isPending ? 'Saving…' : save.isSuccess ? 'Saved' : ''}
            </p>
          )}
        </SettingsGroup>
      )}
      <VoicePhoneNumbers />
      <LatticeSection />
      {orgId ? <McpConnectorsSection orgId={orgId} canManage={canManage} /> : null}
    </SettingsSectionPage>
  );
}
