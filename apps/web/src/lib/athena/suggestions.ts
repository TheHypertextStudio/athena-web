/**
 * What Athena offers to do on an empty thread, from the page the person is on.
 *
 * Three prompts, always. A prompt is a complete request the person could have typed, so choosing
 * one fills the composer rather than sending on its own.
 */
import type { PersonalAthenaContext, PersonalAthenaSource } from './presentation';

type SourceKind = PersonalAthenaSource['type'];

const BY_KIND: Readonly<Record<SourceKind, readonly [string, string, string]>> = {
  project: [
    'What is at risk in this project?',
    'Summarize what changed this week',
    'Draft an update for the team',
  ],
  initiative: [
    'Which projects here are behind?',
    'Summarize progress against the target',
    'Draft a status update for leadership',
  ],
  program: [
    'What needs attention across this program?',
    'Summarize what changed this week',
    'Draft an update for the team',
  ],
  task: ['Break this into steps', 'Find related work', 'What is blocking this?'],
  calendar_item: [
    'Prepare me for this',
    'Find the work connected to this',
    'Draft a follow-up after this',
  ],
  stream_event: ['Turn this into a task', 'Find the work this relates to', 'Draft a reply'],
};

const DAY: readonly [string, string, string] = [
  'Plan my afternoon',
  'What needs me today?',
  'What did I finish this week?',
];

/**
 * Three prompts for the given page, or for the day when there is no page.
 *
 * @param context - The merged page context, or null.
 * @returns exactly three distinct prompts.
 */
export function athenaSuggestions(context: PersonalAthenaContext | null): readonly string[] {
  const kind = context?.source?.type;
  if (!kind) return DAY;
  return BY_KIND[kind];
}
