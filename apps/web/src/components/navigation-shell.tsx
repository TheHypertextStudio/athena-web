'use client';

import { AppShell, ImmersiveShell, type AppShellProps } from '@docket/ui/components';
import type { JSX } from 'react';

import { useAppPathname, useAppSearchParams } from '@/lib/app-location';

/** Select an activity workspace for daily planning while retaining the weekly app context. */
export function NavigationShell(props: AppShellProps): JSX.Element {
  const pathname = useAppPathname();
  const search = useAppSearchParams();
  if (pathname === '/plan' && search.get('view') === 'day') {
    return (
      <ImmersiveShell banner={props.banner} contentOverlay={props.contentOverlay}>
        {props.children}
      </ImmersiveShell>
    );
  }
  return <AppShell {...props} />;
}
