'use client';

/**
 * `components/actions/action-domains-provider` — registers every action domain the app declares.
 *
 * @remarks
 * The action registry is mounted by {@link import('@/lib/actions').InteractionProvider}, and each
 * domain declares its own actions in its own module. Something has to introduce the two, and this
 * is the seam: one provider, mounted once inside the registry, that calls each domain's
 * registration hook and renders its children.
 *
 * ## Why a provider rather than a call inside the shell
 *
 * The first version called the task domain's hook from `AppShellFrame`, on the reasoning that the
 * shell is the outermost real UI below the registry. That coupled a component whose job is chrome
 * to a context it has no other use for, and three test files that render the shell on its own
 * immediately failed with `MissingActionRegistryError` — correctly, because the shell should be
 * mountable without the registry. Registration is provider-tree wiring, so it belongs in the
 * provider tree.
 *
 * A second domain (projects, calendar) adds one line here and nothing anywhere else.
 */
import type { JSX, ReactNode } from 'react';

import { useRegisterTaskActions } from '@/components/tasks/task-actions';

/** Props for {@link ActionDomainsProvider}. */
export interface ActionDomainsProviderProps {
  /** The tree that can dispatch the registered actions. */
  children: ReactNode;
}

/**
 * Register the app's action domains for as long as the tree is mounted.
 *
 * @param props - The {@link ActionDomainsProviderProps}.
 * @returns its children, unchanged.
 */
export default function ActionDomainsProvider({
  children,
}: ActionDomainsProviderProps): JSX.Element {
  useRegisterTaskActions();
  return <>{children}</>;
}
