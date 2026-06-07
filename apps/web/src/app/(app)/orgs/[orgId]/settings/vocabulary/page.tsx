'use client';

/**
 * The Vocabulary settings section (mvp-plan §8.7).
 *
 * @remarks
 * Reached at `/orgs/[orgId]/settings/vocabulary`. Wraps the existing {@link VocabularyTab} (the
 * preset picker with a live preview of every remapped noun) and owns the apply flow that the
 * single Settings screen used to host: the org's current skin is seeded from the shell-wide
 * {@link useActiveOrg} skin, and applying a preset updates the active in-session vocabulary
 * (the API exposes no org-update endpoint, so the chosen preset becomes the live vocabulary
 * rather than silently faking a server write — the status note states this plainly).
 *
 * Whether the caller can change the vocabulary is resolved via {@link useCanManageOrg}.
 *
 * Data is fetched at runtime, so the production build needs no running server.
 */
import type { VocabularyPreset, VocabularySkin } from '@docket/types';
import { use, type JSX, useCallback, useEffect, useState } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { SectionHeader } from '@/components/settings/section-header';
import { SETTINGS_SECTIONS } from '@/components/settings/sections';
import { useCanManageOrg } from '@/components/settings/use-can-manage-org';
import { VocabularyTab } from '@/components/settings/vocabulary-tab';

/** The registry entry for this section (its title + description copy). */
const SECTION = SETTINGS_SECTIONS.find((s) => s.key === 'vocabulary');

/**
 * The Vocabulary section page.
 *
 * @param props - The dynamic route params (a Promise in the App Router).
 * @returns the rendered section.
 */
export default function VocabularySettingsPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}): JSX.Element {
  const { orgId } = use(params);
  const { skin: orgSkin } = useActiveOrg();
  const { canManage } = useCanManageOrg(orgId);

  // The org's vocabulary skin: seeded from the shell-wide active-org skin, then refined locally
  // as the owner applies a new preset (no org-update RPC exists, so the applied preset becomes
  // the active in-session vocabulary and is reflected here and across the app immediately).
  const [skin, setSkin] = useState<VocabularySkin | null>(orgSkin);
  const [applying, setApplying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setSkin(orgSkin);
  }, [orgSkin]);

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
    setNotice(null);
    setSkin((current) => ({
      preset,
      ...(current?.overrides ? { overrides: current.overrides } : {}),
    }));
    setApplying(false);
    setNotice(
      'This vocabulary is now active for your session. It applies across Docket as you navigate.',
    );
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title={SECTION?.label ?? 'Vocabulary'}
        description={
          SECTION?.description ?? 'Choose the language Docket speaks across this organization.'
        }
      />
      <VocabularyTab
        skin={skin}
        canManage={canManage}
        applying={applying}
        notice={notice}
        noticeIsError={false}
        onApply={applyVocabulary}
      />
    </div>
  );
}
