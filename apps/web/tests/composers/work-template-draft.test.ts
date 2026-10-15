import { describe, expect, it } from 'vitest';
import { ComposerDraftPayload } from '@docket/work/composer-draft-contract';
import {
  hydrateWorkTemplateSelection,
  serializeWorkTemplateSelection,
} from '@/components/composer/work-template-draft';

const workTypeId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const workTypeVersionId = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
describe('persistent composer work-template selection', () => {
  it.each(['task', 'project', 'initiative', 'program'] as const)(
    'keeps a %s published snapshot across draft save and reopen',
    (kind) => {
      const selected = {
        workTypeId,
        workTypeVersionId,
        blueprint: {
          previewToken: `sha256:${'a'.repeat(64)}`,
          optionalChoices: [{ path: ['prepare'], selected: false }],
        },
      };
      const wire = ComposerDraftPayload.parse({
        kind,
        ...serializeWorkTemplateSelection(selected),
      });
      if (wire.kind === 'team') throw new Error('Expected a work draft');
      expect(hydrateWorkTemplateSelection(wire)).toEqual(selected);
    },
  );
  it('keeps old drafts on the base and refuses malformed identities', () => {
    expect(hydrateWorkTemplateSelection({})).toEqual({});
    expect(serializeWorkTemplateSelection({})).toEqual({});
    expect(() => serializeWorkTemplateSelection({ workTypeId: 'Event' })).toThrow();
  });
});
