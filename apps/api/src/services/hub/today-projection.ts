import type { Priority } from '@docket/types';

/** Scheduling evidence used to distinguish an untouched day from a generated empty one. */
export type TodayReadiness = 'not_generated' | 'ready' | 'empty_week';

/** Minimal accepted-plan task shape required by the pure Today selectors. */
export interface TodayPlanCandidate {
  readonly id: string;
  readonly organizationId: string;
  readonly title: string;
  readonly state: string;
  readonly priority: Priority;
  readonly assigneeId?: string | null | undefined;
  readonly projectId?: string | null | undefined;
  readonly dueDate?: string | null | undefined;
  readonly planItemId: string;
  readonly planStatus: 'planned' | 'done';
  readonly sort: number;
  readonly position: number;
  readonly estimateMinutes: number | null;
  readonly timeboxStartsAt: string | null;
  readonly timeboxEndsAt: string | null;
  readonly blocked: boolean;
  readonly dependencyImpact: number;
  readonly reason: string;
}

/** Relevance facts for one visible Project or Initiative status candidate. */
export interface TodayStatusCandidate {
  readonly id: string;
  readonly kind: 'project' | 'initiative';
  readonly organizationId: string;
  readonly storyKey: string;
  readonly linkedToFocus: boolean;
  readonly linkedToToday: boolean;
  readonly risk: 0 | 1 | 2;
  readonly stale: boolean;
  readonly targetSoon: boolean;
  readonly updatedAt: string | null;
}

/** Feasibility and ranking facts for one momentum candidate. */
export interface TodaySuggestionCandidate {
  readonly id: string;
  readonly visible: boolean;
  readonly alreadyPlanned: boolean;
  readonly blocked: boolean;
  readonly terminal: boolean;
  readonly estimateMinutes: number;
  readonly dependencyImpact: number;
  readonly priority: Priority;
  readonly dueDate: string | null;
  readonly startDate: string | null;
  readonly updatedAt: string | null;
}

/** Count only free minutes that remain inside a day's scheduling bounds. */
export function remainingAvailableMinutes(input: {
  readonly start: number;
  readonly end: number;
  readonly now: number;
  readonly blocks: readonly { readonly start: number; readonly end: number }[];
}): number {
  const remainingStart = Math.min(input.end, Math.max(input.start, input.now));
  const total = Math.max(0, (input.end - remainingStart) / 60_000);
  const occupied = input.blocks.reduce((minutes, block) => {
    const start = Math.max(remainingStart, block.start);
    const end = Math.min(input.end, block.end);
    return minutes + Math.max(0, end - start) / 60_000;
  }, 0);
  return Math.max(0, Math.floor(total - occupied));
}

/** Derive the page-level state from scheduling evidence and accepted plan rows. */
export function derivePlanState(input: {
  readonly readiness: TodayReadiness;
  readonly items: readonly TodayPlanCandidate[];
}): 'unplanned' | 'active' | 'cleared' {
  if (input.items.some((item) => item.planStatus === 'planned')) return 'active';
  if (input.items.length > 0 || input.readiness !== 'not_generated') return 'cleared';
  return 'unplanned';
}

/** Select the current and immediately following actionable plan items. */
export function selectFocus(input: {
  readonly items: readonly TodayPlanCandidate[];
  readonly now: Date;
  readonly activeTaskId?: string | null;
}): { now: TodayPlanCandidate | null; after: TodayPlanCandidate | null } {
  const actionable = [...input.items]
    .filter((item) => item.planStatus === 'planned' && !item.blocked)
    .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
  const active = input.activeTaskId
    ? actionable.find((item) => item.id === input.activeTaskId)
    : undefined;
  const currentTimebox = actionable.find((item) => {
    if (!item.timeboxStartsAt || !item.timeboxEndsAt) return false;
    const startsAt = new Date(item.timeboxStartsAt).getTime();
    const endsAt = new Date(item.timeboxEndsAt).getTime();
    const now = input.now.getTime();
    return startsAt <= now && now < endsAt;
  });
  const current = active ?? currentTimebox ?? actionable[0] ?? null;
  const after = actionable.find((item) => item.id !== current?.id) ?? null;
  return { now: current, after };
}

/** Select a finite set of non-repeating status stories. */
export function selectStatusCards(
  candidates: readonly TodayStatusCandidate[],
): TodayStatusCandidate[] {
  const sorted = [...candidates].sort((left, right) => {
    const scoreDelta = statusScore(right) - statusScore(left);
    return scoreDelta || left.id.localeCompare(right.id);
  });
  const stories = new Set<string>();
  const organizations = new Set<string>();
  const selected: TodayStatusCandidate[] = [];
  while (selected.length < 4) {
    const eligible = sorted.filter((candidate) => !stories.has(candidate.storyKey));
    const first = eligible[0];
    if (!first) break;
    const bestScore = statusScore(first);
    const candidate =
      eligible.find(
        (item) => statusScore(item) === bestScore && !organizations.has(item.organizationId),
      ) ?? first;
    stories.add(candidate.storyKey);
    organizations.add(candidate.organizationId);
    selected.push(candidate);
  }
  return selected;
}

/** Select feasible additional work for the remaining day. */
export function selectMomentum(input: {
  readonly candidates: readonly TodaySuggestionCandidate[];
  readonly date: string;
  readonly remainingMinutes: number;
  readonly largestSpanMinutes: number;
}): TodaySuggestionCandidate[] {
  return [...input.candidates]
    .filter(
      (candidate) =>
        candidate.visible &&
        !candidate.alreadyPlanned &&
        !candidate.blocked &&
        !candidate.terminal &&
        (candidate.startDate === null || candidate.startDate <= input.date) &&
        candidate.estimateMinutes > 0 &&
        candidate.estimateMinutes <= input.remainingMinutes &&
        candidate.estimateMinutes <= input.largestSpanMinutes,
    )
    .sort((left, right) => {
      const tupleDelta = compareTuple(
        suggestionScore(left, input.date),
        suggestionScore(right, input.date),
      );
      return tupleDelta || left.id.localeCompare(right.id);
    })
    .slice(0, 3);
}

function statusScore(candidate: TodayStatusCandidate): number {
  const updateRecency = candidate.updatedAt ? 1 : 0;
  return (
    Number(candidate.linkedToFocus) * 1_000 +
    Number(candidate.linkedToToday) * 100 +
    candidate.risk * 50 +
    Number(candidate.stale) * 30 +
    Number(candidate.targetSoon) * 20 +
    updateRecency
  );
}

function suggestionScore(candidate: TodaySuggestionCandidate, date: string): readonly number[] {
  const priorityRank: Record<Priority, number> = {
    none: 0,
    low: 1,
    medium: 2,
    high: 3,
    urgent: 4,
  };
  const dueRank = candidate.dueDate
    ? candidate.dueDate < date
      ? 3
      : candidate.dueDate === date
        ? 2
        : 1
    : 0;
  const readyRank = candidate.startDate && candidate.startDate <= date ? 1 : 0;
  const updateRank = candidate.updatedAt ? new Date(candidate.updatedAt).getTime() : 0;
  return [
    candidate.dependencyImpact,
    priorityRank[candidate.priority],
    dueRank,
    readyRank,
    updateRank,
  ];
}

function compareTuple(left: readonly number[], right: readonly number[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (right[index] ?? 0) - (left[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}
