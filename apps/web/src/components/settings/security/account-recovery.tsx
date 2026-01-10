import KeyOutlinedIcon from '@mui/icons-material/KeyOutlined';
import {
  getBackupCodesInfo,
  getSettings,
  type BackupCodesInfo,
  type Settings,
} from '@/lib/security-data';
import { ApiError, type ApiErrorCode } from '@/lib/api-errors';
import { SettingsSection, SettingsRow, SectionError } from '@/components/settings/settings-section';
import { GenerateBackupCodesButton, EncryptionToggle } from './recovery-actions';

export async function AccountRecoverySection() {
  let backupInfo: BackupCodesInfo | null = null;
  let settings: Settings | null = null;
  let errorCode: ApiErrorCode | null = null;

  try {
    const [backupResult, settingsResult] = await Promise.all([getBackupCodesInfo(), getSettings()]);
    backupInfo = backupResult;
    settings = settingsResult.data;
  } catch (e) {
    errorCode = e instanceof ApiError ? e.code : 'unknown';
  }

  if (errorCode || !backupInfo || !settings) {
    return (
      <SettingsSection title="Account Recovery" description="Backup codes and security settings.">
        <SectionError code={errorCode ?? 'unknown'} />
      </SettingsSection>
    );
  }

  return (
    <SettingsSection title="Account Recovery" description="Backup codes and security settings.">
      <div className="divide-outline-variant divide-y">
        <SettingsRow
          label="Backup Codes"
          description={
            backupInfo.hasBackupCodes
              ? `${String(backupInfo.remainingCount)} codes remaining`
              : 'Not generated'
          }
        >
          <div className="flex items-center gap-2">
            {backupInfo.hasBackupCodes && (
              <KeyOutlinedIcon sx={{ fontSize: 16 }} className="text-on-surface-variant" />
            )}
            <GenerateBackupCodesButton hasExisting={backupInfo.hasBackupCodes} />
          </div>
        </SettingsRow>

        <SettingsRow
          label="Encryption at Rest"
          description="Encrypt your data stored on our servers"
        >
          <EncryptionToggle enabled={settings.encryptionEnabled} />
        </SettingsRow>
      </div>
    </SettingsSection>
  );
}
