import { redirect } from 'next/navigation';

/** Redirect the former workspace-owned Athena route to the personal workspace filter. */
export default async function LegacyWorkspaceAthenaPage({
  params,
}: {
  readonly params: Promise<{ readonly orgId: string }>;
}): Promise<never> {
  const { orgId } = await params;
  redirect(`/athena?workspace=${orgId}`);
}
