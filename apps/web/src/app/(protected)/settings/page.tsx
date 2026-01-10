import { redirect } from 'next/navigation';

/**
 * Settings index page - redirects to account settings.
 */
export default function SettingsPage() {
  redirect('/settings/account');
}
