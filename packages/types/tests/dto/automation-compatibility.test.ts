import {
  ActionSpec as DomainActionSpec,
  AutomationEventMatch as DomainAutomationEventMatch,
  AutomationRule as DomainAutomationRule,
  Predicate as DomainPredicate,
  PredicateLeafOp as DomainPredicateLeafOp,
  PredicateValue as DomainPredicateValue,
} from '@docket/automation/contracts';
import {
  ActionSpec as LegacyActionSpec,
  AutomationEventMatch as LegacyAutomationEventMatch,
  AutomationRule as LegacyAutomationRule,
  Predicate as LegacyPredicate,
  PredicateLeafOp as LegacyPredicateLeafOp,
  PredicateValue as LegacyPredicateValue,
} from '@docket/types';
import { describe, expect, it } from 'vitest';

describe('Automation Rules compatibility', () => {
  it('re-exports the domain-owned rule grammar without creating a second runtime schema', () => {
    expect(LegacyPredicateValue).toBe(DomainPredicateValue);
    expect(LegacyPredicateLeafOp).toBe(DomainPredicateLeafOp);
    expect(LegacyPredicate).toBe(DomainPredicate);
    expect(LegacyActionSpec).toBe(DomainActionSpec);
    expect(LegacyAutomationEventMatch).toBe(DomainAutomationEventMatch);
    expect(LegacyAutomationRule).toBe(DomainAutomationRule);
  });
});
