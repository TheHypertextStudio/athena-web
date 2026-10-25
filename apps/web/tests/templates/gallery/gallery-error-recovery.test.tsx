import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { GalleryReview } from '@/components/templates/gallery/gallery-review';
import { galleryPreview } from './gallery-fixture';
import { scrollIntoViewSpy } from '../../support/scroll-into-view';
afterEach(cleanup);
function Review({ stale = false }: { readonly stale?: boolean }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <GalleryReview
      preview={galleryPreview()}
      workspaceName="Community programs"
      selectedItems={[]}
      state={{ pending: false, updating: false, error, blocked: stale && Boolean(error) }}
      onMode={() => undefined}
      onBack={() => undefined}
      onAccept={() => {
        setError('Your reviewed choices are still here.');
      }}
      recoveryAction={
        stale
          ? {
              label: 'Review updated copy',
              onSelect: () => {
                setError(null);
              },
            }
          : undefined
      }
    />
  );
}
it('reveals the failed copy beside its recovery controls after an attempted Keep', () => {
  const { scroll, restore } = scrollIntoViewSpy();
  try {
    render(<Review />);
    fireEvent.click(screen.getByRole('button', { name: 'Keep private drafts' }));
    const recovery = screen.getByRole('region', { name: 'Copy could not be saved' });
    expect(recovery).toHaveFocus();
    expect(scroll).toHaveBeenCalledWith({ block: 'center' });
    expect(screen.getByRole('button', { name: 'Keep private drafts' })).toBeEnabled();
  } finally {
    restore();
  }
});
it('keeps stale-review recovery with its error while the old Keep action is blocked', () => {
  const { scroll, restore } = scrollIntoViewSpy();
  try {
    render(<Review stale />);
    fireEvent.click(screen.getByRole('button', { name: 'Keep private drafts' }));
    const recovery = screen.getByRole('region', { name: 'Copy could not be saved' });
    const refresh = screen.getByRole('button', { name: 'Review updated copy' });
    expect(recovery).toContainElement(refresh);
    expect(recovery.closest('[aria-busy]')).toHaveAttribute('aria-busy', 'false');
    expect(screen.getByRole('button', { name: 'Keep private drafts' })).toBeDisabled();
    fireEvent.click(refresh);
    expect(
      screen.queryByRole('region', { name: 'Copy could not be saved' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Review selected templates' })).toHaveFocus();
    expect(scroll).toHaveBeenCalledWith({ block: 'start' });
  } finally {
    restore();
  }
});
