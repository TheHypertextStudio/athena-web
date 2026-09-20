import type { MentionItem } from '@/lib/contracts/mention';

/** A menu action stays local to the UI and can never become a persisted mention. */
export interface CreatePersonMentionChoice {
  readonly origin: 'create-person';
  readonly id: string;
  readonly title: string;
  readonly select: () => void;
}

/** Selectable mention results and explicit creation actions. */
export type MentionChoice = MentionItem | CreatePersonMentionChoice;
