import { ProgramDefaultSchedule } from '../contracts/work-schedule-defaults';
import { galleryOutline, galleryContainer, galleryReference } from './builders';
import type { GallerySlug } from './identities';
interface DefaultOutline {
  readonly key: string;
  readonly name: string;
  readonly template: GallerySlug;
  readonly title: string;
  readonly cadence: unknown;
}
function schedule(input: DefaultOutline): ProgramDefaultSchedule {
  return ProgramDefaultSchedule.parse({
    key: input.key,
    name: input.name,
    template: { targetType: 'project', ...galleryReference(input.template) },
    titlePattern: input.title,
    cadence: input.cadence,
    teamRule: 'parent_team',
    actorRule: 'parent_responsible',
  });
}
const weekly = (weekday: 'tuesday' | 'thursday'): unknown => ({
  kind: 'weekly',
  weekdays: [weekday],
  startOffsetDays: 0,
  end: { kind: 'never' },
});
const monthly = (
  interval: number,
  ordinal: 1 | 2 | -1,
  weekday: 'thursday' | 'friday' | 'monday' | 'saturday',
): unknown => ({
  kind: 'monthly',
  interval,
  startOffsetDays: 0,
  pattern: { kind: 'nth_weekday', ordinal, weekday },
  end: { kind: 'never' },
});
/** Program outlines install real, independent schedule copies through the layer3 writer. */
export const PROGRAM_GALLERY = [
  galleryOutline({
    slug: 'content-calendar',
    purpose:
      'Maintain a useful publishing rhythm through independently editable article and newsletter schedules.',
    fields: [
      [
        'Editorial focus',
        'Define the audience, useful topics and standards that should guide this publishing rhythm.',
      ],
      [
        'Schedule ownership',
        'Review the Blog post and Newsletter schedules, their destination and responsible person before using the Program.',
      ],
    ],
    defaultSchedules: [
      schedule({
        key: 'blog_post',
        name: 'Weekly blog post',
        template: 'blog-post',
        title: '{month} {day} article',
        cadence: weekly('tuesday'),
      }),
      schedule({
        key: 'newsletter',
        name: 'Monthly newsletter',
        template: 'newsletter-issue',
        title: '{month} {year} newsletter',
        cadence: monthly(1, -1, 'friday'),
      }),
    ],
  }),
  galleryOutline({
    slug: 'client-engagement',
    purpose:
      'Start an agency engagement clearly and maintain an independent monthly reporting rhythm for the client.',
    fields: [
      [
        'Engagement scope',
        'Link the agreed scope, client decision maker and practical working arrangements.',
      ],
      [
        'Reporting rhythm',
        'Review the monthly report schedule against the actual reporting period and client commitments.',
      ],
    ],
    steps: [
      galleryContainer({
        key: 'kickoff',
        kind: 'project',
        name: 'Kickoff',
        purpose: 'Align the engagement before recurring delivery begins.',
        checklist:
          'Confirm scope, responsibilities and the immediate delivery plan.|Keep the client’s source documents in their owning system.',
        templateSlug: 'kickoff',
        days: 7,
      }),
    ],
    defaultSchedules: [
      schedule({
        key: 'monthly_report',
        name: 'Monthly client report',
        template: 'monthly-client-report',
        title: '{month} {year} client report',
        cadence: monthly(1, 1, 'monday'),
      }),
    ],
  }),
  galleryOutline({
    slug: 'program-delivery',
    purpose:
      'Run a nonprofit program through independently managed session and cohort schedules with a clear participant outcome.',
    fields: [
      ['Program outcome', 'Define who the Program serves and the intended participant benefit.'],
      [
        'Delivery choices',
        'Review the Session and Cohort schedules; pause any rhythm that does not match this Program’s actual delivery model.',
      ],
    ],
    defaultSchedules: [
      schedule({
        key: 'sessions',
        name: 'Weekly sessions',
        template: 'session',
        title: '{month} {day} session',
        cadence: weekly('tuesday'),
      }),
      schedule({
        key: 'cohorts',
        name: 'Quarterly cohorts',
        template: 'cohort',
        title: 'Q{quarter} {year} cohort',
        cadence: monthly(3, 1, 'monday'),
      }),
    ],
  }),
  galleryOutline({
    slug: 'event-series',
    purpose:
      'Maintain an event series with independent community-event and workshop schedules suited to its audience.',
    fields: [
      ['Audience and purpose', 'Explain the community or client need that this series serves.'],
      [
        'Event rhythm',
        'Review the Community event and Workshop schedules and keep only the rhythms appropriate to this series.',
      ],
    ],
    defaultSchedules: [
      schedule({
        key: 'community',
        name: 'Monthly community event',
        template: 'community-event',
        title: '{month} community event',
        cadence: monthly(1, 2, 'thursday'),
      }),
      schedule({
        key: 'workshops',
        name: 'Quarterly workshop',
        template: 'workshop',
        title: 'Q{quarter} {year} workshop',
        cadence: monthly(3, 1, 'saturday'),
      }),
    ],
  }),
];
