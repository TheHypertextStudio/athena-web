import FingerprintOutlinedIcon from '@mui/icons-material/FingerprintOutlined';
import {
  getPasskeys,
  getLinkedAccounts,
  type Passkey,
  type LinkedAccount,
} from '@/lib/security-data';
import { ApiError, type ApiErrorCode } from '@/lib/api-errors';
import {
  SettingsSection,
  SettingsItemCard,
  SettingsEmptyState,
  SectionError,
} from '@/components/settings/settings-section';
import { PasskeyActions, AddPasskeyButton } from './passkeys-actions';

export async function PasskeysSection() {
  let passkeys: Passkey[] = [];
  let accounts: LinkedAccount[] = [];
  let errorCode: ApiErrorCode | null = null;

  try {
    const [passkeysResult, accountsResult] = await Promise.all([
      getPasskeys(),
      getLinkedAccounts(),
    ]);
    passkeys = passkeysResult.passkeys;
    accounts = accountsResult.accounts;
  } catch (e) {
    errorCode = e instanceof ApiError ? e.code : 'unknown';
  }

  if (errorCode) {
    return (
      <SettingsSection
        title="Passkeys"
        description="Passkeys let you sign in securely using your device's biometrics or security key."
      >
        <SectionError code={errorCode} />
      </SettingsSection>
    );
  }

  const hasOtherSignInMethods = accounts.length > 0;

  return (
    <SettingsSection
      title="Passkeys"
      description="Passkeys let you sign in securely using your device's biometrics or security key."
    >
      <div className="space-y-3">
        {passkeys.length > 0 ? (
          passkeys.map((passkey) => (
            <SettingsItemCard
              key={passkey.id}
              icon={<FingerprintOutlinedIcon sx={{ fontSize: 20 }} />}
              title={passkey.name ?? 'Unnamed passkey'}
              description={`Added ${new Date(passkey.createdAt).toLocaleDateString()}${passkey.deviceType ? ` • ${passkey.deviceType}` : ''}${passkey.backedUp ? ' • Synced' : ''}`}
              action={
                <PasskeyActions
                  passkey={passkey}
                  canDelete={passkeys.length > 1 || hasOtherSignInMethods}
                />
              }
            />
          ))
        ) : (
          <SettingsEmptyState message="No passkeys registered yet." />
        )}

        <AddPasskeyButton />
      </div>
    </SettingsSection>
  );
}
