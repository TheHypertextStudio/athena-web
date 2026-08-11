import { redirect } from 'next/navigation';

/**
 * Canonicalize a bare workspace URL to its work list.
 *
 * @remarks
 * `/orgs/[orgId]` is a valid workspace destination, but it has no independent screen. Redirecting
 * before rendering prevents links such as a graph's "Back to workspace" action from reaching a
 * root unmatched-route fallback.
 */
export default async function WorkspaceLandingPage({
  params,
}: {
  readonly params: Promise<{ readonly orgId: string }>;
}): Promise<never> {
  const { orgId } = await params;
  redirect(`/orgs/${orgId}/my-work`);
}
