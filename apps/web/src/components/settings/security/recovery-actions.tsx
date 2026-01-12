'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { SettingsAlertBanner } from '@/components/settings/settings-section';
import { authApi, settingsApi } from '@/lib/api-client';

interface GenerateBackupCodesButtonProps {
  hasExisting: boolean;
}

export function GenerateBackupCodesButton({ hasExisting }: GenerateBackupCodesButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [generatedCodes, setGeneratedCodes] = useState<string[] | null>(null);

  const handleGenerate = () => {
    startTransition(async () => {
      const result = await authApi.generateBackupCodes();
      setGeneratedCodes(result.codes);
      router.refresh();
    });
  };

  const handleDismiss = () => {
    setGeneratedCodes(null);
  };

  return (
    <>
      <Button variant="outlined" size="sm" onClick={handleGenerate} disabled={isPending}>
        {isPending ? 'Generating...' : hasExisting ? 'Regenerate' : 'Generate'}
      </Button>

      {generatedCodes && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-surface mx-4 max-w-md rounded-lg p-6 shadow-xl">
            <SettingsAlertBanner
              icon={<ShieldOutlinedIcon sx={{ fontSize: 20 }} />}
              title="Save your backup codes"
              variant="warning"
            >
              <p className="mb-3">
                Store these codes in a safe place. Each code can only be used once.
              </p>
              <div className="grid grid-cols-2 gap-2 font-mono text-sm">
                {generatedCodes.map((code, i) => (
                  <div
                    key={i}
                    className="bg-surface-container-highest text-on-surface rounded px-2 py-1"
                  >
                    {code}
                  </div>
                ))}
              </div>
              <Button variant="outlined" size="sm" className="mt-3" onClick={handleDismiss}>
                I've saved these codes
              </Button>
            </SettingsAlertBanner>
          </div>
        </div>
      )}
    </>
  );
}

interface EncryptionToggleProps {
  enabled: boolean;
}

export function EncryptionToggle({ enabled }: EncryptionToggleProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isEnabled, setIsEnabled] = useState(enabled);

  const handleToggle = (checked: boolean) => {
    setIsEnabled(checked);
    startTransition(async () => {
      await settingsApi.update({ encryptionEnabled: checked });
      router.refresh();
    });
  };

  return <Switch checked={isEnabled} onCheckedChange={handleToggle} disabled={isPending} />;
}
