'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Settings index page - redirects to account settings.
 */
export default function SettingsPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/settings/account');
  }, [router]);

  return null;
}
