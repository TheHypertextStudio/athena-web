'use client';

import type { ProfileSettingsOut, ProfileSettingsUpdate } from '@docket/types';
import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { useSession } from '@/lib/auth-client';
import { SectionHeader } from '@/components/settings/section-header';
import { SettingsImagePicker } from '@/components/settings/settings-image-picker';
import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import { unwrap, useApiMutation } from '@/lib/query';
import { useDebouncedAutosave } from '@/lib/use-debounced-autosave';
import { Input } from '@docket/ui/primitives';

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
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Profile"
        description="Manage your name, email, and personal identity."
      />
      {/* placeholder: the signed-in account's name, email and avatar — unknown until the session
          resolves. Deliberately a line of copy rather than grey bars: the shape of a profile is
          not interesting enough to be worth miming. */}
      {isPending ? (
        <p className="text-on-surface-variant text-body-medium" role="status">
          Loading your profile…
        </p>
      ) : session ? (
        <section className="border-outline-variant flex max-w-2xl flex-col gap-5 rounded-lg border p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-on-surface text-sm font-semibold">Your identity</h2>
              <p className="text-on-surface-variant text-sm">
                This is the identity Athena uses when working across your connected services.
              </p>
            </div>
            {save.isPending ? (
              <p className="text-on-surface-variant shrink-0 text-xs" role="status">
                Saving…
              </p>
            ) : save.isSuccess ? (
              <p className="text-on-surface-variant shrink-0 text-xs" role="status">
                Saved
              </p>
            ) : null}
          </div>
          <label className="text-on-surface flex max-w-md flex-col gap-1.5 text-sm font-medium">
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
              <span className="text-error text-xs font-normal" role="alert">
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
            <p className="text-error text-sm" role="alert">
              {userErrorMessage(save.error, 'Could not save your profile.')}
            </p>
          ) : null}
          <div className="border-outline-variant border-t pt-4">
            <p className="text-on-surface-variant text-xs">Email</p>
            <p className="text-on-surface text-sm font-medium">{session.user.email}</p>
            <p className="text-on-surface-variant mt-1 text-xs">
              Change your sign-in email from Security, where the confirmation step is protected.
            </p>
          </div>
        </section>
      ) : null}
    </div>
  );
}
