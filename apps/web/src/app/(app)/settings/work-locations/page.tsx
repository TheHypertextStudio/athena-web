import { redirect } from 'next/navigation';

/** Preserve old Work locations links while the split destinations replace the legacy page. */
export default function WorkLocationsSettingsRedirect(): never {
  redirect('/settings/work-schedule');
}
