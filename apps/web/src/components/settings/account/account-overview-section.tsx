import { getAccountOverview, type AccountOverview } from '@/lib/account-data';
import { ApiError, type ApiErrorCode } from '@/lib/api-errors';
import { SettingsSection, SectionError } from '@/components/settings/settings-section';

export async function AccountOverviewSection() {
  let account: AccountOverview | null = null;
  let errorCode: ApiErrorCode | null = null;

  try {
    const result = await getAccountOverview();
    account = result.data;
  } catch (e) {
    errorCode = e instanceof ApiError ? e.code : 'unknown';
  }

  if (errorCode || !account) {
    return (
      <SettingsSection title="Account Overview" description="Your account statistics.">
        <SectionError code={errorCode ?? 'unknown'} />
      </SettingsSection>
    );
  }

  const memberSince = new Date(account.createdAt).toLocaleDateString();

  return (
    <SettingsSection title="Account Overview" description={`Member since ${memberSince}`}>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="text-center">
          <div className="text-2xl font-bold">{account.stats.initiatives}</div>
          <div className="text-muted-foreground text-sm">Initiatives</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold">{account.stats.projects}</div>
          <div className="text-muted-foreground text-sm">Projects</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold">{account.stats.tasks}</div>
          <div className="text-muted-foreground text-sm">Tasks</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold">{account.stats.events}</div>
          <div className="text-muted-foreground text-sm">Events</div>
        </div>
      </div>
    </SettingsSection>
  );
}
