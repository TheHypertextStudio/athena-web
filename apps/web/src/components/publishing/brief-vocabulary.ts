/**
 * `publishing` — turning a brief's raw wire values into the words a reader sees.
 *
 * @remarks
 * The public brief endpoint returns enum members, ISO timestamps, and the publishing
 * workspace's vocabulary skin — never a sentence. Every word on a published page is composed
 * here, in the application layer that owns its copy.
 *
 * The vocabulary skin matters more on a brief than anywhere else in the product. Inside the app
 * a reader has context for "Initiative"; a printed sheet handed to a board member does not, and
 * calling the thing what the workspace calls it ("Campaign", "Engagement") is the difference
 * between a document that reads as theirs and one that reads as a tool's export.
 */
import type {
  BriefFact,
  BriefSection,
  PublicationSubjectKind,
} from '@docket/work/publish-contract';
import type { Health } from '@docket/work/capability-contract';
import {
  VOCABULARY_PRESETS,
  type VocabularyKey,
  type VocabularySkin,
  type VocabularyTerm,
} from '@docket/work/vocabulary';

/**
 * Resolve one vocabulary term against a workspace's skin.
 *
 * @remarks
 * The same resolution `useVocabulary` performs — a per-key override, else the workspace's preset
 * — but as a pure function, because a brief is server-rendered and has no React context to read
 * from. No third fallback is needed: every preset is a total map over the vocabulary keys, so the
 * preset lookup always resolves.
 *
 * @param skin - The publishing workspace's vocabulary skin.
 * @param key - Which term to resolve.
 * @returns The singular/plural pair.
 */
export function briefTerm(skin: VocabularySkin, key: VocabularyKey): VocabularyTerm {
  const override = skin.overrides?.[key];
  if (override) return override;
  return VOCABULARY_PRESETS[skin.preset][key];
}

/** Human label for each initiative status. */
const INITIATIVE_STATUS: Record<string, string> = {
  proposed: 'Proposed',
  active: 'Active',
  completed: 'Completed',
  canceled: 'Canceled',
};

/** Human label for each program status. */
const PROGRAM_STATUS: Record<string, string> = {
  active: 'Active',
  paused: 'Paused',
  archived: 'Archived',
};

/** Human label for each project status. */
const PROJECT_STATUS: Record<string, string> = {
  planned: 'Planned',
  active: 'In progress',
  completed: 'Completed',
  canceled: 'Canceled',
};

/** Human label for each health verdict. */
const HEALTH: Record<Health, string> = {
  on_track: 'On track',
  at_risk: 'At risk',
  off_track: 'Off track',
};

/** Human label for each priority. */
const PRIORITY: Record<string, string> = {
  none: 'None',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

/**
 * The status word for a raw status value in the context of the record that carries it.
 *
 * @remarks
 * The three work tables use overlapping-but-different status enums (`active` means "in progress"
 * on a project and "running" on a program), so the record kind is part of the lookup rather than
 * one merged map. An unrecognised value falls through to itself: better a reader sees a raw key
 * than an empty cell, and a brief must never silently drop a fact.
 *
 * @param kind - Which record the status belongs to.
 * @param value - The raw enum member.
 * @returns The display word.
 */
export function briefStatusLabel(kind: PublicationSubjectKind | 'task', value: string): string {
  if (kind === 'initiative') return INITIATIVE_STATUS[value] ?? value;
  if (kind === 'program') return PROGRAM_STATUS[value] ?? value;
  if (kind === 'project') return PROJECT_STATUS[value] ?? value;
  // A task's status arrives already resolved to its team's own workflow-state name.
  return value;
}

/** The label for one masthead fact, given the kind of record the brief describes. */
export function briefFactLabel(kind: PublicationSubjectKind, key: BriefFact['key']): string {
  switch (key) {
    case 'status':
      return 'Status';
    case 'health':
      return 'Health';
    case 'priority':
      return 'Priority';
    case 'owner':
      // A project has a lead rather than an owner; the same column, a different word.
      return kind === 'project' ? 'Lead' : 'Owner';
    case 'startDate':
      return 'Start';
    case 'targetDate':
      return 'Target';
    default:
      return key;
  }
}

/** The rendered value for one masthead fact, or `null` when there is nothing to show. */
export function briefFactValue(
  kind: PublicationSubjectKind,
  fact: BriefFact,
  formatDate: (iso: string) => string | null,
): string | null {
  if (fact.value === null) return null;
  switch (fact.key) {
    case 'status':
      return briefStatusLabel(kind, fact.value);
    case 'health':
      return HEALTH[fact.value as Health];
    case 'priority':
      return PRIORITY[fact.value] ?? fact.value;
    case 'startDate':
    case 'targetDate':
      return formatDate(fact.value);
    default:
      return fact.value;
  }
}

/** The heading for one section of work, in the publishing workspace's own vocabulary. */
export function briefSectionHeading(skin: VocabularySkin, key: BriefSection['key']): string {
  switch (key) {
    case 'programs':
      return briefTerm(skin, 'program').plural;
    case 'projects':
      return briefTerm(skin, 'project').plural;
    case 'tasks':
      return briefTerm(skin, 'task').plural;
    default:
      return 'Milestones';
  }
}

/** The word for the kind of record a brief describes, in the workspace's own vocabulary. */
export function briefKindLabel(skin: VocabularySkin, kind: PublicationSubjectKind): string {
  return briefTerm(skin, kind).singular;
}
