/** Deterministic Initiative attention ranking. */
import type {
  InitiativeAttentionSeverity,
  InitiativeStatus,
  InitiativeUpdateCadence,
} from '@docket/types';

const CADENCE_DAYS: Record<Exclude<InitiativeUpdateCadence, 'none'>, number> = {
  weekly: 7,
  biweekly: 14,
  monthly: 30,
  quarterly: 90,
};
const SEVERITY_ORDER: Record<InitiativeAttentionSeverity, number> = {
  off_track: 0,
  at_risk: 1,
  stale: 2,
};

/** Minimal row required to decide whether an Initiative needs attention. */
export interface InitiativeAttentionCandidate {
  readonly id: string;
  readonly status: InitiativeStatus;
  readonly health: 'on_track' | 'at_risk' | 'off_track' | null;
  readonly updateCadence: InitiativeUpdateCadence;
  readonly createdAt: Date;
  readonly lastUpdateAt: Date | null;
}

/** Attention decision paired with its source candidate. */
export interface RankedInitiativeAttention {
  readonly candidate: InitiativeAttentionCandidate;
  readonly severity: InitiativeAttentionSeverity;
  readonly action: 'open' | 'update';
}

/** Rank active/proposed risk and stale-active Initiatives, deduplicated and capped at four. */
export function rankInitiativeAttention(
  candidates: readonly InitiativeAttentionCandidate[],
  now: Date,
): RankedInitiativeAttention[] {
  return candidates
    .flatMap((candidate): RankedInitiativeAttention[] => {
      if (candidate.status === 'completed' || candidate.status === 'canceled') return [];
      if (candidate.health === 'off_track') {
        return [{ candidate, severity: 'off_track', action: 'open' }];
      }
      if (candidate.health === 'at_risk') {
        return [{ candidate, severity: 'at_risk', action: 'open' }];
      }
      if (candidate.status !== 'active' || candidate.updateCadence === 'none') return [];
      const baseline = candidate.lastUpdateAt ?? candidate.createdAt;
      const threshold = CADENCE_DAYS[candidate.updateCadence] * 86_400_000;
      return now.getTime() - baseline.getTime() >= threshold
        ? [{ candidate, severity: 'stale', action: 'update' }]
        : [];
    })
    .sort((left, right) => {
      const severity = SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity];
      if (severity !== 0) return severity;
      const leftDate = left.candidate.lastUpdateAt ?? left.candidate.createdAt;
      const rightDate = right.candidate.lastUpdateAt ?? right.candidate.createdAt;
      return (
        leftDate.getTime() - rightDate.getTime() ||
        left.candidate.id.localeCompare(right.candidate.id)
      );
    })
    .slice(0, 4);
}
