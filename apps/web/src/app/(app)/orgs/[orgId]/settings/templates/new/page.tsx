'use client';
import type { JSX } from 'react';
import { WorkTemplateAuthoring } from '@/components/templates/work-template-authoring';
import { useTypedRoute } from '@/lib/app-location';

/** Author a private work-template draft before explicitly publishing it. */
export default function NewWorkTemplatePage(): JSX.Element {
  const {
    params: { orgId },
  } = useTypedRoute('/orgs/[orgId]/settings/templates/new');
  return <WorkTemplateAuthoring orgId={orgId} id={null} />;
}
