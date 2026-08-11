import type { JSX } from 'react';

import { AgentsStrip } from '@/components/marketing/agents-strip';
import { ClosingSection } from '@/components/marketing/closing-section';
import { FeatureBand } from '@/components/marketing/feature-band';
import { FeatureSplit } from '@/components/marketing/feature-split';
import { Hero } from '@/components/marketing/hero';
import { OrganizationsPair } from '@/components/marketing/organizations-pair';

/**
 * Marketing home page.
 *
 * @remarks
 * Six titles that can be read while scrolling past them, in the order someone evaluates the
 * product: a task, then the things tasks belong to, then the organizations those live in, then
 * the calendar, then agents. Time tracking, status updates, and connected tools sit in
 * {@link SecondaryList} below, because they are not what anyone arrives shopping for.
 *
 * No two adjacent sections share a shape. Split, band, split, pair, band, strip — the plate moves
 * side to side and changes size down the page. Six identical title-and-plate blocks in a row is
 * what makes a landing page read as generated, and it is a structural tell rather than a copy one.
 */
export default function HomePage(): JSX.Element {
  return (
    <>
      <Hero />
      <FeatureSplit
        title="Track tasks"
        description="Tasks keep estimates, schedules, and tracked time together."
        side="right"
        surface="Task list and task detail"
      />
      <FeatureBand
        title="Group work into projects and programs"
        description="Projects end; programs continue."
        surface="A project beside a program"
        tone="paper"
      />
      <FeatureSplit
        title="Align work with initiatives"
        description="Initiatives connect goals to responsible work."
        side="left"
        surface="An initiative with projects rolling into it"
      />
      <OrganizationsPair />
      <FeatureBand
        title="Place tasks on the calendar"
        description="Calendar placement shows whether planned work fits."
        surface="The calendar with tasks scheduled against meetings"
        tone="ink"
      />
      <AgentsStrip />
      <ClosingSection pricing />
    </>
  );
}
