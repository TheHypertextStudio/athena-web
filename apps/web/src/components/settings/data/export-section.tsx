import { SettingsSection } from '@/components/settings/settings-section';
import { ExportActions } from './export-actions';

export function ExportSection() {
  return (
    <SettingsSection
      title="Export Data"
      description="Download all your data in a machine-readable format."
    >
      <div className="space-y-4">
        <p className="text-on-surface-variant text-sm">
          Your export will include all your initiatives, projects, tasks, events, activities, and
          settings in JSON format. This may take a moment to generate.
        </p>
        <ExportActions />
      </div>
    </SettingsSection>
  );
}
