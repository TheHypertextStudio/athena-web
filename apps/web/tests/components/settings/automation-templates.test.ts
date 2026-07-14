import { describe, expect, it } from 'vitest';

import { automationTemplateInput } from '../../../src/components/settings/automations-tab';

describe('automationTemplateInput', () => {
  it('builds an archive-on-completion rule from user-facing choices', () => {
    expect(automationTemplateInput('archive_completed_email', 'Archive completed work')).toEqual({
      name: 'Archive completed work',
      enabled: true,
      on: { kind: 'completed', subjectType: 'task' },
      when: { op: 'and', nodes: [] },
      then: [{ type: 'mail.archive', params: {} }],
    });
  });

  it('builds a promotions-dismissal rule from user-facing choices', () => {
    expect(automationTemplateInput('dismiss_promotions', 'Clear promotions')).toMatchObject({
      name: 'Clear promotions',
      on: { kind: 'created', subjectType: 'email_suggestion' },
      when: { op: 'eq', path: 'detail.category', value: 'promotions' },
      then: [{ type: 'suggestion.dismiss', params: {} }],
    });
  });
});
