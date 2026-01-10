import { ExportSection, DeleteSection } from '@/components/settings/data';

export default function DataSettingsPage() {
  return (
    <div className="space-y-6">
      <ExportSection />
      <DeleteSection />
    </div>
  );
}
