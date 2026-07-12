'use client';

import { useContextState } from '@docket/ui/components';
import { Button } from '@docket/ui/primitives';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { type JSX, type SyntheticEvent, useCallback, useState } from 'react';

import { WorkspaceNameField } from '@/components/workspace-creation/workspace-name-field';
import { writeLastOrg } from '@/components/app-shell-utils';
import { authClient } from '@/lib/auth-client';
import { queryKeys } from '@/lib/query';
import { createWorkspace } from '@/lib/workspace-creation';

/**
 * Focused repeat-workspace creation page.
 *
 * @remarks
 * Existing users only name the new shared workspace. Docket applies its standard terminology,
 * refreshes the shell's organization list, binds the new context, and opens My Work. First-run
 * personal-space setup remains owned by onboarding.
 *
 * @returns the authenticated workspace-creation form.
 */
export default function NewWorkspacePage(): JSX.Element {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { setContext } = useContextState();
  const { data: session } = authClient.useSession();
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameReady = name.trim().length > 0;

  const submit = useCallback(async (): Promise<void> => {
    if (!nameReady || pending) return;
    setError(null);
    setPending(true);
    try {
      const result = await createWorkspace({
        name: name.trim(),
        isPersonal: false,
        vocabulary: 'startup',
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.orgs() });
      setContext(result.organization.id);
      writeLastOrg(session?.user.id ?? null, result.organization.id);
      router.replace(`/orgs/${result.organization.id}/my-work`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create your workspace.');
    } finally {
      setPending(false);
    }
  }, [nameReady, pending, name, queryClient, setContext, session?.user.id, router]);

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void submit();
  };

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col px-6 py-12 sm:py-16">
      <div className="mb-8 flex flex-col gap-2">
        <span className="text-on-surface-variant text-xs font-medium">New workspace</span>
        <h1 className="text-on-surface text-3xl font-semibold tracking-tight text-balance">
          Create a workspace
        </h1>
        <p className="text-on-surface-variant max-w-xl text-base text-balance">
          Give your team a shared home for its projects, tasks, and day-to-day work.
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-8">
        <WorkspaceNameField
          value={name}
          onChange={setName}
          onSubmit={() => {
            void submit();
          }}
          canSubmit={nameReady && !pending}
        />

        {error ? (
          <p role="alert" className="text-destructive text-body">
            {error}
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-3">
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              router.back();
            }}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={!nameReady || pending}>
            {pending ? 'Creating workspace…' : 'Create workspace'}
          </Button>
        </div>
      </form>
    </main>
  );
}
