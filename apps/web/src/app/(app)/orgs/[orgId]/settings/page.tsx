import { redirect } from 'next/navigation';

import { DEFAULT_SETTINGS_SECTION, sectionHref } from '@/components/settings/sections';

/**
 * The Settings area root — redirects to the primary section.
 *
 * @remarks
 * The settings shell always shows a concrete section, so the bare `/orgs/[orgId]/settings`
 * route has no content of its own; it redirects to {@link DEFAULT_SETTINGS_SECTION} (Members &
 * Access, the primary always-available section). Using `redirect` (rather than rendering a
 * landing page) keeps a single canonical URL per section and means the section list never has
 * an "empty" active state.
 *
 * @param props - The dynamic route params (a Promise in the App Router).
 * @returns never — it always redirects.
 */
export default async function SettingsRootPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}): Promise<never> {
  const { orgId } = await params;
  redirect(sectionHref(orgId, DEFAULT_SETTINGS_SECTION));
}
