'use client';

import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { authClient, useSession } from '@/lib/auth-client';
import { SectionHeader } from '@/components/settings/section-header';
import { Button, Input } from '@docket/ui/primitives';

/** The signed-in user's profile destination. */
export default function GlobalProfileSettingsPage(): JSX.Element {
  const { data: session, isPending } = useSession();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (session?.user.name) setName(session.user.name);
  }, [session?.user.name]);

  async function saveProfile(): Promise<void> {
    if (!name.trim() || name.trim() === session?.user.name) return;
    setSaving(true);
    setFeedback(null);
    const result = await authClient.updateUser({ name: name.trim() });
    setSaving(false);
    setFeedback(result.error ? 'Could not save your profile.' : 'Profile saved.');
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Profile"
        description="Manage your name, email, and personal identity."
      />
      {isPending ? (
        <p className="text-on-surface-variant text-body" role="status">
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
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </label>
          <div className="flex items-center gap-3">
            <Button
              disabled={saving || !name.trim() || name.trim() === session.user.name}
              onClick={() => {
                void saveProfile();
              }}
            >
              {saving ? 'Saving…' : 'Save profile'}
            </Button>
            {feedback ? (
              <p className="text-on-surface-variant text-xs" role="status">
                {feedback}
              </p>
            ) : null}
          </div>
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
