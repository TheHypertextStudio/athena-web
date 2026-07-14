import { redirect } from 'next/navigation';

/** Send the global Settings root to the first user-owned destination. */
export default function GlobalSettingsRootPage(): never {
  redirect('/settings/profile');
}
