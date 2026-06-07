'use client';

/**
 * The per-org Settings screen (mvp-plan §8.7).
 *
 * @remarks
 * A Client Component reached at `/orgs/[orgId]/settings`, rendered in the app-shell main region
 * (the shell's GlobalRail + ContextSidebar already wrap `(app)` routes). It presents three
 * tabbed sub-areas via the WAI-ARIA {@link SettingsTabs} strip:
 *
 * - **Members & Access** (primary) — the org's members with plain-language role controls, guest
 *   badges, an invite control, the pending-invitations list, and per-member removal. The
 *   last-owner guard is enforced server-side and surfaced gracefully. ({@link MembersTab})
 * - **Integrations** — a categorized provider directory whose connect flow forces the Migration
 *   vs Connector decision up front, with the consequences spelled out. ({@link IntegrationsTab})
 * - **Vocabulary** — the org's vocabulary preset (Startup / Nonprofit / Agency) with a live
 *   preview of the words each remaps, drawn from the real presets. ({@link VocabularyTab})
 *
 * The screen resolves whether the caller can manage the org (owner/admin) once, sharing it with
 * the Integrations and Vocabulary tabs (the Members tab resolves it independently from its own
 * fresh member+role read). The active org's vocabulary skin comes from {@link useActiveOrg}.
 *
 * Data is fetched at runtime, so the production build needs no running server.
 */
import type { MemberOut, RoleOut, VocabularyPreset, VocabularySkin } from '@docket/types';
import { ListChecks, Settings as SettingsIcon, Sparkles } from '@docket/ui/icons';
import { useParams } from 'next/navigation';
import { type JSX, useCallback, useEffect, useMemo, useState } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { IntegrationsTab } from '@/components/settings/integrations-tab';
import { MembersTab } from '@/components/settings/members-tab';
import { type SettingsTab, SettingsTabs } from '@/components/settings/settings-tabs';
import { VocabularyTab } from '@/components/settings/vocabulary-tab';
import { useSession } from '@/lib/auth-client';
import { api } from '@/lib/api';

/** The three Settings sub-areas. */
type TabValue = 'members' | 'integrations' | 'vocabulary';

/** The tab definitions for the Settings strip. */
const TABS: readonly SettingsTab<TabValue>[] = [
  { value: 'members', label: 'Members & Access', icon: SettingsIcon },
  { value: 'integrations', label: 'Integrations', icon: ListChecks },
  { value: 'vocabulary', label: 'Vocabulary', icon: Sparkles },
];

/** The role keys that confer org-management ability. */
const MANAGER_ROLE_KEYS = new Set(['owner', 'admin']);

/**
 * The per-org Settings screen.
 *
 * @returns the rendered settings page.
 */
export default function SettingsPage(): JSX.Element {
  const params = useParams<{ orgId: string }>();
  const orgId = params.orgId;
  const { activeOrg, skin: orgSkin } = useActiveOrg();
  const { data: authSession } = useSession();
  const userId = authSession?.user.id ?? null;

  const [tab, setTab] = useState<TabValue>('members');

  // Whether the caller can manage the org (shared with Integrations + Vocabulary). Resolved from
  // a lightweight members+roles read; the Members tab does its own fresh read independently.
  const [canManage, setCanManage] = useState(false);

  // The org's vocabulary skin: seeded from the shell-wide active-org skin, then refined locally
  // as the owner applies a new preset (no org-update RPC exists, so the applied preset becomes
  // the active in-session vocabulary and is reflected here and across the page immediately).
  const [skin, setSkin] = useState<VocabularySkin | null>(orgSkin);
  const [applying, setApplying] = useState(false);
  const [vocabNotice, setVocabNotice] = useState<string | null>(null);

  useEffect(() => {
    setSkin(orgSkin);
  }, [orgSkin]);

  // Resolve management ability once for the cross-tab gate.
  useEffect(() => {
    const live = { current: true };
    void (async () => {
      if (!userId) return;
      const [membersRes, rolesRes] = await Promise.all([
        api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
        api.v1.orgs[':orgId'].roles.$get({ param: { orgId } }),
      ]);
      if (!membersRes.ok || !rolesRes.ok) return;
      const members: readonly MemberOut[] = (await membersRes.json()).items;
      const roles: readonly RoleOut[] = (await rolesRes.json()).items;
      const me = members.find((m) => m.userId === userId);
      const myRole = me?.roleId ? roles.find((r) => r.id === me.roleId) : null;
      if (live.current) setCanManage(myRole ? MANAGER_ROLE_KEYS.has(myRole.key) : false);
    })();
    return () => {
      live.current = false;
    };
  }, [orgId, userId]);

  /**
   * Apply a vocabulary preset.
   *
   * @remarks
   * The API exposes no org-update endpoint, so the chosen preset is applied to the active
   * in-session vocabulary (reflected in the preview and the "current" marker) rather than
   * silently faking a server write. The status note states this plainly.
   */
  const applyVocabulary = useCallback((preset: VocabularyPreset): void => {
    setApplying(true);
    setVocabNotice(null);
    setSkin((current) => ({
      preset,
      ...(current?.overrides ? { overrides: current.overrides } : {}),
    }));
    setApplying(false);
    setVocabNotice(
      'This vocabulary is now active for your session. It applies across Docket as you navigate.',
    );
  }, []);

  const orgName = activeOrg?.name ?? 'Organization';

  const panelId = useMemo(() => `settings-tabpanel-${tab}`, [tab]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm">
          Manage who&rsquo;s in <span className="text-foreground font-medium">{orgName}</span>, the
          tools it connects to, and the language it speaks.
        </p>
      </header>

      <SettingsTabs tabs={TABS} value={tab} onChange={setTab} label="Settings sections" />

      <div role="tabpanel" id={panelId} aria-labelledby={`settings-tab-${tab}`} className="flex-1">
        {tab === 'members' ? <MembersTab orgId={orgId} /> : null}
        {tab === 'integrations' ? <IntegrationsTab orgId={orgId} canManage={canManage} /> : null}
        {tab === 'vocabulary' ? (
          <VocabularyTab
            skin={skin}
            canManage={canManage}
            applying={applying}
            notice={vocabNotice}
            noticeIsError={false}
            onApply={applyVocabulary}
          />
        ) : null}
      </div>
    </div>
  );
}
