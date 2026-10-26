'use client';
import type { JSX } from 'react';
import { TabPanel } from '@docket/ui/primitives';
import { ProgramSubjectRef } from '@docket/work/subject-ref-contract';
import { useEntityMentions } from '@/lib/use-entity-mentions';
import {
  WorkResourcesPanel,
  type WorkResourcesPanelProps,
} from '@/components/entity-detail/work-resources-panel';

/** Program Resources navigation with derived reads enabled only while the tab is visible. */
export function ProgramResourcesSection(
  props: Omit<WorkResourcesPanelProps, 'mentions' | 'subjectType'> & {
    readonly active: boolean;
  },
): JSX.Element {
  const mentions = useEntityMentions(
    props.orgId,
    ProgramSubjectRef.parse({ subjectType: 'program', subjectId: props.subjectId }),
    props.active,
  );
  return (
    <TabPanel
      value="resources"
      hidden={!props.active}
      render={() => <WorkResourcesPanel {...props} subjectType="program" mentions={mentions} />}
    />
  );
}
