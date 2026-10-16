'use client';
import type { JSX } from 'react';
import { WorkTemplateAuthoring } from '@/components/templates/work-template-authoring';
import { useTypedRoute } from '@/lib/app-location';

/** Edit a work-template draft, publish it, and read retained versions. */
export default function WorkTemplatePage(): JSX.Element {
  const {
    params: { orgId, templateId },
  } = useTypedRoute('/orgs/[orgId]/work-templates/[templateId]');
  return <WorkTemplateAuthoring orgId={orgId} id={templateId} />;
}
