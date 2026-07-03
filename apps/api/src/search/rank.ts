import type { SearchDocumentKind } from '@docket/types';

const BASE_RANK: Record<SearchDocumentKind, number> = {
  task: 100,
  project: 95,
  comment: 90,
  program: 88,
  calendar_event: 84,
  activity: 80,
  update: 76,
  attachment: 74,
  initiative: 72,
  milestone: 68,
  cycle: 64,
  saved_view: 60,
  team: 56,
  member: 54,
  agent: 52,
  agent_session: 50,
  label: 44,
  organization: 40,
};

/** Entity-family prior used before text rank, recency, and relationship boosts. */
export function baseRankFor(kind: SearchDocumentKind): number {
  return BASE_RANK[kind];
}
