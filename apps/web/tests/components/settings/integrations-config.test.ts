/**
 * Unit tests for the per-provider connector copy map ({@link connectorCopy}) and the
 * `hasInlineConfigPanel` gate that decides which providers get a "Configure" toggle on the
 * generic {@link IntegrationProviderCard} row.
 *
 * @remarks
 * The config panel used to hardcode Google-Tasks wording; these tests pin that the copy map
 * resolves distinct, user-terms wording per provider (Linear vs Google Tasks) rather than a
 * single flat string, and that a provider with no dedicated entry falls back to generic copy
 * instead of throwing or rendering `undefined`.
 */
import { describe, expect, it } from 'vitest';

import {
  CONNECTOR_COPY,
  connectorCopy,
  hasInlineConfigPanel,
} from '../../../src/components/settings/integrations-config';

describe('connectorCopy', () => {
  it('resolves distinct container wording for linear ("team") vs gtasks ("task list")', () => {
    const linear = connectorCopy('linear');
    const gtasks = connectorCopy('gtasks');

    expect(linear.containerNoun).toBe('team');
    expect(linear.containerNounPlural).toBe('teams');
    expect(gtasks.containerNoun).toBe('task list');
    expect(gtasks.containerNounPlural).toBe('task lists');
    expect(linear.containerNoun).not.toBe(gtasks.containerNoun);
  });

  it('keeps gtasks\' "sync all"/"select at least one" checklist copy in its original bare wording', () => {
    // The checklist has always read "Sync all lists" / "Select at least one list…" — bare, not
    // "task list(s)" like the legend/empty-state captions — so `checklistNoun`/`checklistNounPlural`
    // must stay the historical bare noun even though `containerNoun`/`containerNounPlural` (used
    // elsewhere on the same panel) are the fuller "task list(s)".
    const gtasks = connectorCopy('gtasks');
    expect(gtasks.checklistNoun).toBe('list');
    expect(gtasks.checklistNounPlural).toBe('lists');
  });

  it('gives linear a user-terms blurb naming what it mirrors, without provider jargon like "issues API"', () => {
    const linear = connectorCopy('linear');
    expect(linear.connectBlurb).toBe('Mirror Linear issues, projects, and cycles into Docket.');
    expect(linear.connectBlurb.toLowerCase()).not.toContain('api');
  });

  it('flags linear (and only linear) as team-mapping — the picker branch that uses `config.teamMappings`', () => {
    expect(connectorCopy('linear').usesTeamMapping).toBe(true);
    expect(connectorCopy('gtasks').usesTeamMapping).toBe(false);
  });

  it('gives every direction (import-only, two-way) real, distinct detail copy for each provider', () => {
    for (const provider of Object.keys(CONNECTOR_COPY)) {
      const copy = connectorCopy(provider);
      expect(copy.direction.importOnly).toBeTruthy();
      expect(copy.direction.twoWay).toBeTruthy();
      expect(copy.direction.importOnly).not.toBe(copy.direction.twoWay);
    }
  });

  it('falls back to generic (non-empty, provider-agnostic) copy for a provider with no dedicated entry', () => {
    const fallback = connectorCopy('github');
    expect(fallback.containerNoun).toBeTruthy();
    expect(fallback.connectBlurb).toBeTruthy();
    expect(fallback.connectBlurb.toLowerCase()).not.toContain('linear');
    expect(fallback.connectBlurb.toLowerCase()).not.toContain('google');
    expect(fallback.usesTeamMapping).toBe(false);
  });
});

describe('hasInlineConfigPanel', () => {
  it('is true for linear (its config lives on the generic Connections card)', () => {
    expect(hasInlineConfigPanel('linear')).toBe(true);
  });

  it('is false for gtasks (it renders its own dedicated multi-account section instead)', () => {
    expect(hasInlineConfigPanel('gtasks')).toBe(false);
  });

  it('is false for a provider with no config panel at all', () => {
    expect(hasInlineConfigPanel('github')).toBe(false);
    expect(hasInlineConfigPanel('drive')).toBe(false);
  });
});
