import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import { SettingsSection, SettingsAlertBanner } from '@/components/settings/settings-section';
import { DeleteActions } from './delete-actions';

export function DeleteSection() {
  return (
    <SettingsSection
      title="Delete Account"
      description="Permanently delete your account and all associated data."
      variant="destructive"
    >
      <div className="space-y-4">
        <SettingsAlertBanner
          icon={<WarningAmberOutlinedIcon sx={{ fontSize: 20 }} />}
          title="This action is irreversible"
          variant="error"
        >
          Deleting your account will permanently remove all your data including initiatives,
          projects, tasks, events, and settings. This cannot be undone.
        </SettingsAlertBanner>

        <DeleteActions />
      </div>
    </SettingsSection>
  );
}
