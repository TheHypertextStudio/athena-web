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
import { Button, Input } from '@docket/ui/primitives';

/** The signed-in user's profile destination. */
export default function GlobalProfileSettingsPage(): JSX.Element {
  const { data: session, isPending, refetch } = useSession();
  const [name, setName] = useState('');
  const [image, setImage] = useState('');
  const [baseline, setBaseline] = useState({ name: '', image: '' });
  const [feedback, setFeedback] = useState<string | null>(null);

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
      setFeedback('Profile saved.');
      void refetch();
    },
  });

  function saveProfile(): void {
    if (!name.trim()) return;
    setFeedback(null);
    save.mutate({
      ...(name.trim() !== baseline.name ? { name: name.trim() } : {}),
      ...(image.trim() !== baseline.image
        ? { image: image.startsWith('data:image/') ? image : null }
        : {}),
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Profile"
        description="Manage your name, email, and personal identity."
      />
      {isPending ? (
        <p className="text-on-surface-variant text-body-medium" role="status">
          Loading your profile…
        </p>
      ) : session ? (
        <section className="border-outline-variant flex max-w-2xl flex-col gap-5 rounded-lg border p-5">
          <div>
            <h2 className="text-on-surface text-sm font-semibold">Your identity</h2>
            <p className="text-on-surface-variant text-sm">
              This is the identity Athena uses when working across your connected services.
            </p>
          </div>
          <label className="text-on-surface flex max-w-md flex-col gap-1.5 text-sm font-medium">
            Name
            <Input
              value={name}
              disabled={save.isPending}
              maxLength={120}
              onChange={(event) => {
                setName(event.target.value);
                setFeedback(null);
              }}
            />
          </label>
          <SettingsImagePicker
            label="Profile photo"
            value={image}
            disabled={save.isPending}
            fallback={(name.trim()[0] ?? session.user.email[0] ?? '?').toUpperCase()}
            onChange={(value) => {
              setImage(value);
              setFeedback(null);
            }}
          />
          <div className="flex items-center gap-3">
            <Button
              disabled={
                save.isPending ||
                !name.trim() ||
                (name.trim() === baseline.name && image.trim() === baseline.image)
              }
              onClick={() => {
                saveProfile();
              }}
            >
              {save.isPending ? 'Saving…' : 'Save profile'}
            </Button>
            {feedback ? (
              <p className="text-on-surface-variant text-xs" role="status">
                {feedback}
              </p>
            ) : null}
          </div>
          {save.error ? (
            <p className="text-destructive text-sm" role="alert">
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
