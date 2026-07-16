import { redirect } from 'next/navigation';

/** Redirect the legacy workspace session feed to personal Athena filtered to that workspace. */
export default async function LegacyWorkspaceAgentsPage({
  params,
}: {
  readonly params: Promise<{ readonly orgId: string }>;
}): Promise<never> {
  const { orgId } = await params;
  redirect(`/athena?workspace=${orgId}`);
}
