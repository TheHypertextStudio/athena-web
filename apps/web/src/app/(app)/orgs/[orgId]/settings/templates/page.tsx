'use client';
import type { JSX } from 'react';
import { WorkTemplateSettings } from '@/components/templates/work-template-settings';
import { useTypedRoute } from '@/lib/app-location';

/** The workspace's versioned work-template library. */
export default function TemplatesSettingsPage(): JSX.Element {
  const {
    params: { orgId },
  } = useTypedRoute('/orgs/[orgId]/settings/templates');
  return <WorkTemplateSettings orgId={orgId} />;
}
