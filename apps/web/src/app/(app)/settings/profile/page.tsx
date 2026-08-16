'use client';

import type { ProfileSettingsOut, ProfileSettingsUpdate } from '@docket/types';
import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { useSession } from '@/lib/auth-client';
import { SettingsImagePicker } from '@/components/settings/settings-image-picker';
import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import { unwrap, useApiMutation } from '@/lib/query';
import { useDebouncedAutosave } from '@/lib/use-debounced-autosave';
import { Input } from '@docket/ui/primitives';
import { SettingRowStatus } from '@/components/settings/setting-row-status';
import { SettingsGroup } from '@/components/settings/settings-group';
import { SettingsSectionPage } from '@/components/settings/settings-section-page';

/** The signed-in user's profile destination. */
export default function GlobalProfileSettingsPage(): JSX.Element {
  const { data: session, isPending, refetch } = useSession();
  const [name, setName] = useState('');
  const [image, setImage] = useState('');
  const [baseline, setBaseline] = useState({ name: '', image: '' });
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    if (!session?.user) return;
    const next = { name: session.user.name, image: session.user.image ?? '' };
    setName(next.name);
    setImage(next.image);
    setBaseline(next);
  }, [session?.user]);

  const save = useApiMutation<ProfileSettingsOut, ProfileSettingsUpdate>({
    mutationFn: (json) =>
      unwrap(() => api.v1.me.account.profile.$patch({ json }), 'Could not save your profile.'),
    onSuccess: (profile) => {
      const next = { name: profile.name, image: profile.image ?? '' };
      setName(next.name);
      setImage(next.image);
      setBaseline(next);
      void refetch();
    },
  });

  // Autosave replaces the former hand-rolled `commitName` dirty-check: the field persists on a
  // quiet debounce once it differs from what's loaded, and never on mount or for an unchanged
  // value — the same seam every other autosaving field in the app now shares.
  useDebouncedAutosave({
    value: name.trim(),
    baseline: baseline.name,
    ready: Boolean(session),
    save: (trimmed) => {
      if (!trimmed) {
        setNameError('Your name cannot be empty.');
        return;
      }
      setNameError(null);
      save.mutate({ name: trimmed });
    },
  });

  function commitImage(next: string): void {
    if (next.trim() === baseline.image) return;
    save.mutate({ image: next.startsWith('data:image/') ? next : null });
  }

  return (
    <SettingsSectionPage sectionKey="profile" loading={isPending}>
      {session ? (
        <SettingsGroup
          title="Your identity"
          description="This is the identity Athena uses when working across your connected services."
          action={<SettingRowStatus pending={save.isPending} saved={save.isSuccess} />}
        >
          <label className="text-on-surface text-label-large flex flex-col gap-1.5">
            Name
            <Input
              value={name}
              maxLength={120}
              aria-invalid={nameError ? true : undefined}
              onChange={(event) => {
                setName(event.target.value);
                setNameError(null);
              }}
            />
            {nameError ? (
              <span className="text-error text-body-small" role="alert">
                {nameError}
              </span>
            ) : null}
          </label>
          <SettingsImagePicker
            label="Profile photo"
            value={image}
            fallback={(name.trim()[0] ?? session.user.email[0] ?? '?').toUpperCase()}
            onChange={(value) => {
              setImage(value);
              commitImage(value);
            }}
          />
          {save.error ? (
            <p className="text-error text-body-medium" role="alert">
              {userErrorMessage(save.error, 'Could not save your profile.')}
            </p>
          ) : null}
          <div className="pt-4">
            <p className="text-on-surface-variant text-body-small">Email</p>
            <p className="text-on-surface text-label-large">{session.user.email}</p>
            <p className="text-on-surface-variant text-body-small mt-1">
              Change your sign-in email from Security, where the confirmation step is protected.
            </p>
          </div>
        </SettingsGroup>
      ) : null}
    </SettingsSectionPage>
  );
}
