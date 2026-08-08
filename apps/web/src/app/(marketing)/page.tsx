import type { JSX } from 'react';

import { AgentsStrip } from '@/components/marketing/agents-strip';
import { ClosingSection } from '@/components/marketing/closing-section';
import { FeatureBand } from '@/components/marketing/feature-band';
import { FeatureSplit } from '@/components/marketing/feature-split';
import { Hero } from '@/components/marketing/hero';
import { OrganizationsPair } from '@/components/marketing/organizations-pair';
import { SecondaryList } from '@/components/marketing/secondary-list';

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
        description="You guess how long something will take and then never find out if you were right. The estimate and the hours you log both belong to the same task, so at the end of a week you can see exactly where you were off."
        side="right"
        surface="Task list and task detail"
      />
      <FeatureBand
        title="Group work into projects and programs"
        description="A membership drive or a support rota never ships. Most tools only know 'project,' so it gets flagged overdue for months at a time. Docket has a separate type for work with no end date, and stops flagging it."
        surface="A project beside a program"
        tone="paper"
      />
      <FeatureSplit
        title="Align work with initiatives"
        description="A goal like 'grow membership 20% this year' depends on work spread across projects and organizations, and most tools have no place to track that dependency. An initiative in Docket does, so you can tell if you're going to hit the goal instead of finding out after the year ends."
        side="left"
        surface="An initiative with projects rolling into it"
      />
      <OrganizationsPair />
      <FeatureBand
        title="Turn your plan into your week"
        description="Docket puts your tasks on the calendar you already use, next to the meetings on it. You can tell whether what you planned actually fits before the week starts, not after."
        surface="The calendar with tasks scheduled against meetings"
        tone="ink"
      />
      <AgentsStrip />
      <SecondaryList />
      <ClosingSection pricing />
    </>
  );
}
