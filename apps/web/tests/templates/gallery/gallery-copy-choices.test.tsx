import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WorkTemplateGalleryPreview,
  WorkTemplateGalleryPreviewRequest,
} from '@docket/work/template-gallery-contract';
import { GalleryCopyChoices } from '@/components/templates/gallery/gallery-copy-choices';
import { galleryFixture } from './gallery-fixture';
afterEach(cleanup);
const labelId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
function fixtures() {
  const bug = galleryFixture('bug-report');
  const request = WorkTemplateGalleryPreviewRequest.parse({
    roots: ['bug-report'],
    release: 1,
    mode: 'private_drafts',
  });
  const preview = WorkTemplateGalleryPreview.parse({
    roots: [bug.identity],
    reviewFingerprint: `sha256:${'0'.repeat(64)}`,
    mode: 'private_drafts',
    copies: [
      {
        source: bug.identity,
        name: bug.name,
        targetType: bug.targetType,
        definition: bug.definition,
        offeredTeamIds: [],
        dependencies: [],
      },
    ],
    omissions: [
      { source: bug.identity, kind: 'label_suggestion', path: [], count: 1, value: 'Bug' },
    ],
  });
  return { bug, request, preview };
}
describe('explicit destination mappings', () => {
  it('never maps a suggested label by name and retains the control after a checked mapped preview', () => {
    const { bug, request, preview } = fixtures(),
      onChange = vi.fn();
    const props = {
      request,
      preview,
      selectedItems: [bug],
      labelOptions: [{ value: labelId, label: 'Bug' }],
      teamOptions: [],
      canManageOfferings: false,
      disabled: false,
      onChange,
    };
    const view = render(<GalleryCopyChoices {...props} />);
    expect(screen.getByRole('combobox', { name: 'Map Bug for Bug report' })).toHaveValue('');
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('combobox', { name: 'Map Bug for Bug report' }), {
      target: { value: labelId },
    });
    const changed = WorkTemplateGalleryPreviewRequest.parse(onChange.mock.calls[0]?.[0]);
    expect(changed.labels).toEqual([
      { sourceSlug: 'bug-report', suggestion: 'Bug', destinationLabelId: labelId },
    ]);
    view.rerender(
      <GalleryCopyChoices {...props} request={changed} preview={{ ...preview, omissions: [] }} />,
    );
    expect(screen.getByRole('combobox', { name: 'Map Bug for Bug report' })).toHaveValue(labelId);
    fireEvent.change(screen.getByRole('combobox', { name: 'Map Bug for Bug report' }), {
      target: { value: '' },
    });
    expect(onChange.mock.calls[1]?.[0].labels).toEqual([]);
  });
});
