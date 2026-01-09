'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import { useAccount } from '@/hooks/use-settings';
import { SettingsSection, SettingsAlertBanner } from '@/components/settings/settings-section';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

export default function DataSettingsPage() {
  const router = useRouter();
  const { isExporting, deleteAccount, isDeleting } = useAccount();
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const handleExport = async () => {
    try {
      // The export endpoint returns JSON data
      const response = await fetch('/api/account/export', {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Export failed');
      }

      const data: unknown = await response.json();

      // Create a download link for the JSON data
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `athena-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export failed:', error);
      alert('Failed to export data. Please try again.');
    }
  };

  const handleDeleteAccount = () => {
    if (deleteConfirmation !== 'DELETE') {
      return;
    }

    deleteAccount('DELETE');
    // Redirect to home after deletion
    router.push('/');
  };

  return (
    <div className="space-y-6">
      {/* Data Export */}
      <SettingsSection
        title="Export Data"
        description="Download all your data in a machine-readable format."
      >
        <div className="space-y-4">
          <p className="text-on-surface-variant text-sm">
            Your export will include all your initiatives, projects, tasks, events, activities, and
            settings in JSON format. This may take a moment to generate.
          </p>
          <Button
            variant="outline"
            onClick={() => {
              void handleExport();
            }}
            disabled={isExporting}
          >
            <FileDownloadOutlinedIcon sx={{ fontSize: 18 }} className="mr-2" />
            {isExporting ? 'Preparing export...' : 'Export My Data'}
          </Button>
        </div>
      </SettingsSection>

      {/* Danger Zone */}
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

          <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
            <AlertDialogTrigger asChild>
              <Button variant="filled" intent="error">
                <DeleteOutlinedIcon sx={{ fontSize: 18 }} className="mr-2" />
                Delete Account
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. This will permanently delete your account and remove
                  all your data from our servers.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="space-y-2 py-4">
                <Label htmlFor="delete-confirmation">
                  Type <span className="font-mono font-bold">DELETE</span> to confirm
                </Label>
                <Input
                  id="delete-confirmation"
                  value={deleteConfirmation}
                  onChange={(e) => {
                    setDeleteConfirmation(e.target.value);
                  }}
                  placeholder="DELETE"
                />
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel
                  onClick={() => {
                    setDeleteConfirmation('');
                  }}
                >
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDeleteAccount}
                  disabled={deleteConfirmation !== 'DELETE' || isDeleting}
                  className="bg-error text-on-error hover:bg-error/90"
                >
                  {isDeleting ? 'Deleting...' : 'Delete Account'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </SettingsSection>
    </div>
  );
}
