'use client';
import type { JSX } from 'react';
import { Tabs, type TabsActivation } from '@docket/ui/primitives';
import type { TemplateDefinitionSection } from './use-template-section-navigation';
interface DefinitionNavigationProps {
  readonly section: TemplateDefinitionSection;
  readonly onValueChange: (next: string, source?: TabsActivation) => void;
}
/** Freely revisit definition sections without losing input or creating duplicate tab identities. */
export function TemplateDefinitionNavigation(props: DefinitionNavigationProps): JSX.Element {
  return (
    <Tabs
      label="Work definition sections"
      value={props.section}
      onValueChange={props.onValueChange}
      items={[
        { value: 'purpose', label: 'Purpose' },
        { value: 'work', label: 'Starting work' },
        { value: 'structure', label: 'Included work' },
        { value: 'review', label: 'Review' },
      ]}
    />
  );
}
