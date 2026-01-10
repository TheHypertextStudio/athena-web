import { headers } from 'next/headers';
import { auth } from '@/lib/auth-server';
import { getUserSettings, type UserSettings } from '@/lib/account-data';
import { ApiError, type ApiErrorCode } from '@/lib/api-errors';
import { SettingsSection, SectionError } from '@/components/settings/settings-section';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ProfileActions } from './profile-actions';

export async function ProfileSection() {
  let user: { name: string | null; email: string; image?: string | null } | null = null;
  let settings: UserSettings | null = null;
  let errorCode: ApiErrorCode | null = null;

  try {
    const [session, settingsResult] = await Promise.all([
      auth.api.getSession({ headers: await headers() }),
      getUserSettings(),
    ]);
    user = session?.user ?? null;
    settings = settingsResult.data;
  } catch (e) {
    errorCode = e instanceof ApiError ? e.code : 'unknown';
  }

  if (errorCode || !settings) {
    return (
      <SettingsSection
        title="Profile"
        description="Your personal information and how Athena addresses you."
      >
        <SectionError code={errorCode ?? 'unknown'} />
      </SettingsSection>
    );
  }

  const userName = user?.name ?? '';
  const initials = userName
    ? userName
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
    : 'U';

  return (
    <SettingsSection
      title="Profile"
      description="Your personal information and how Athena addresses you."
    >
      <div className="space-y-4">
        {/* Avatar and basic info */}
        <div className="flex items-center gap-4">
          <Avatar className="h-16 w-16">
            <AvatarImage src={user?.image ?? undefined} alt={user?.name ?? 'User'} />
            <AvatarFallback className="text-lg">{initials}</AvatarFallback>
          </Avatar>
          <div>
            <div className="font-medium">{user?.name ?? 'User'}</div>
            <div className="text-muted-foreground text-sm">{user?.email}</div>
          </div>
        </div>

        {/* Preferred name editor */}
        <ProfileActions initialPreferredName={settings.preferredName} />
      </div>
    </SettingsSection>
  );
}
