import { redirect } from 'next/navigation';

/**
 * Redirect the retired vocabulary picker to the active workspace's Settings root.
 *
 * @param props - The dynamic route params (a Promise in the App Router).
 * @returns never; the legacy route always redirects.
 */
export default async function VocabularySettingsPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}): Promise<never> {
  const { orgId } = await params;
  redirect(`/orgs/${orgId}/settings`);
}
