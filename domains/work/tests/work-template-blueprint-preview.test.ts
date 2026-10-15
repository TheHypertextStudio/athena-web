import { describe, expect, it } from 'vitest';
import {
  BlueprintCreationOptions,
  BlueprintPreviewOptions,
  BlueprintCreationPreview,
} from '../src/contracts/work-template-blueprint';

describe('public blueprint creation review contracts', () => {
  it('allows a fresh read-only review of optional choices but requires a token to create them', () => {
    const input = { optionalChoices: [{ path: ['prepare'], selected: false }] };
    expect(BlueprintPreviewOptions.safeParse(input).success).toBe(true);
    expect(BlueprintCreationOptions.safeParse(input).success).toBe(false);
  });
  it('refuses duplicate choices in read-only previews as well as creation', () => {
    const input = {
      optionalChoices: [
        { path: ['prepare'], selected: false },
        { path: ['prepare'], selected: true },
      ],
    };
    expect(BlueprintPreviewOptions.safeParse(input).success).toBe(false);
  });
  it('bounds summaries and refuses private definition or body properties', () => {
    const id = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
    const preview = {
      workTypeId: id,
      workTypeVersionId: id,
      previewToken: `sha256:${'a'.repeat(64)}`,
      resolvedManifest: [],
      descendants: [],
      descendantCount: 0,
      selectedCount: 1,
      additionalMilestoneCount: 0,
      summaryOffset: 0,
      nextSummaryOffset: null,
      warnings: [],
    };
    expect(BlueprintCreationPreview.safeParse(preview).success).toBe(true);
    expect(
      BlueprintCreationPreview.safeParse({
        ...preview,
        definition: { description: 'Private draft' },
      }).success,
    ).toBe(false);
    expect(BlueprintCreationPreview.safeParse({ ...preview, selectedCount: 501 }).success).toBe(
      false,
    );
  });
});
