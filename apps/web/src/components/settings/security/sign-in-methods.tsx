import { getLinkedAccounts, type LinkedAccount } from '@/lib/security-data';
import { ApiError, type ApiErrorCode } from '@/lib/api-errors';
import {
  SettingsSection,
  SettingsItemCard,
  SettingsEmptyState,
  SectionError,
} from '@/components/settings/settings-section';
import { UnlinkAccountButton, LinkAccountButtons } from './sign-in-methods-actions';

const PROVIDER_NAMES: Record<string, string> = {
  google: 'Google',
  apple: 'Apple',
  microsoft: 'Microsoft',
};

const PROVIDER_ICONS: Record<string, string> = {
  google: 'G',
  apple: '',
  microsoft: 'M',
};

const ALL_PROVIDERS = ['google', 'apple', 'microsoft'] as const;

export async function SignInMethodsSection() {
  let accounts: LinkedAccount[] = [];
  let errorCode: ApiErrorCode | null = null;

  try {
    const result = await getLinkedAccounts();
    accounts = result.accounts;
  } catch (e) {
    errorCode = e instanceof ApiError ? e.code : 'unknown';
  }

  if (errorCode) {
    return (
      <SettingsSection title="Sign-in Methods" description="Manage how you sign into your account.">
        <SectionError code={errorCode} />
      </SettingsSection>
    );
  }

  const linkedProviders = new Set(accounts.map((a) => a.providerId));
  const unlinkedProviders = ALL_PROVIDERS.filter((p) => !linkedProviders.has(p));

  return (
    <SettingsSection title="Sign-in Methods" description="Manage how you sign into your account.">
      <div className="space-y-3">
        {accounts.length > 0 ? (
          accounts.map((account) => (
            <SettingsItemCard
              key={account.id}
              icon={
                <span className="text-sm font-medium">
                  {PROVIDER_ICONS[account.providerId] ?? account.providerId[0]?.toUpperCase()}
                </span>
              }
              title={PROVIDER_NAMES[account.providerId] ?? account.providerId}
              description={`Connected ${new Date(account.createdAt).toLocaleDateString()}`}
              action={
                <UnlinkAccountButton
                  accountId={account.id}
                  providerId={account.providerId}
                  providerName={PROVIDER_NAMES[account.providerId] ?? account.providerId}
                  canUnlink={accounts.length > 1}
                />
              }
            />
          ))
        ) : (
          <SettingsEmptyState message="No accounts linked." />
        )}

        {unlinkedProviders.length > 0 && (
          <div className="border-outline-variant mt-4 border-t pt-4">
            <p className="text-on-surface-variant mb-3 text-sm">Link additional accounts</p>
            <LinkAccountButtons providers={unlinkedProviders} />
          </div>
        )}
      </div>
    </SettingsSection>
  );
}
