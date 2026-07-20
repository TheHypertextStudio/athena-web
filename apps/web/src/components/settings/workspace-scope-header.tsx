import NextLink from 'next/link';
import type { JSX } from 'react';

/** Props for {@link WorkspaceScopeHeader}. */
export interface WorkspaceScopeHeaderProps {
  /**
   * Route to the personal "Connected accounts" surface. When present, the header points there for
   * identity linking; when omitted, the linked-accounts list is rendered inline above this surface
   * (the personal Connections page) and the header points "above" instead.
   */
  linkedAccountsHref?: string;
}

/**
 * The "This workspace" zone header, stating that the connections below are workspace-scoped.
 *
 * @remarks
 * This is the structural fix for the scope confusion: connections belong to the workspace (shared,
 * admin-managed), while identity linking is personal. Making scope a titled zone — not a per-row
 * badge — lets every card below inherit it without repeating it.
 */
export function WorkspaceScopeHeader({
  linkedAccountsHref,
}: WorkspaceScopeHeaderProps): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-on-surface text-title-small font-medium">This workspace</h2>
      <p className="text-on-surface-variant text-body-medium max-w-prose">
        These connections belong to this workspace — anyone with access can use them, and workspace
        admins manage them.{' '}
        {linkedAccountsHref ? (
          <>
            Linking a personal account happens in{' '}
            <NextLink
              href={linkedAccountsHref}
              className="text-on-surface font-medium underline-offset-2 hover:underline"
            >
              Connected accounts
            </NextLink>
            .
          </>
        ) : (
          'Personal account links are shown above under Linked accounts.'
        )}
      </p>
    </div>
  );
}
