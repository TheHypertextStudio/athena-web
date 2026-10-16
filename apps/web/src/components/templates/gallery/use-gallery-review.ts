'use client';
import { useEffect, useState } from 'react';
import {
  WorkTemplateGalleryPreview,
  WorkTemplateGalleryPreviewRequest,
} from '@docket/work/template-gallery-contract';
import { userErrorMessage } from '@/lib/problem';
import { useTemplateGalleryPreview } from '../work-template-gallery-queries';
import type { GalleryTabChoices } from './gallery-session';

/** Only the exact current checked request can be accepted; earlier previews stay visibly pending. */
export interface GalleryCheckedReview {
  readonly request: WorkTemplateGalleryPreviewRequest;
  readonly preview: WorkTemplateGalleryPreview;
  readonly key: string;
}
/** Checked preview lifecycle through the actual typed query mutation, including explicit refresh. */
export interface GalleryReviewQuery {
  readonly checked: GalleryCheckedReview | null;
  readonly updating: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
}
/** Recheck every explicit decision and discard superseded responses without caching private documents in storage. */
export function useGalleryReview(
  orgId: string,
  choices: GalleryTabChoices,
  enabled = true,
): GalleryReviewQuery {
  const { mutateAsync } = useTemplateGalleryPreview(orgId);
  const [checked, setChecked] = useState<GalleryCheckedReview | null>(null);
  const [error, setError] = useState<string | null>(null),
    [refreshNumber, setRefreshNumber] = useState(0);
  const [settled, setSettled] = useState<string | null>(null);
  const key = JSON.stringify([choices, refreshNumber]);
  useEffect(() => {
    let current = true;
    if (!enabled) return;
    const parsed = WorkTemplateGalleryPreviewRequest.safeParse(choices);
    if (!parsed.success) {
      setChecked(null);
      setSettled(key);
      return;
    }
    setError(null);
    void mutateAsync(parsed.data)
      .then((value) => {
        if (current)
          setChecked({
            key,
            request: parsed.data,
            preview: WorkTemplateGalleryPreview.parse(value),
          });
      })
      .catch((failure: unknown) => {
        if (current)
          setError(
            userErrorMessage(
              failure,
              'This selection could not be prepared. Keep your choices and try again.',
            ),
          );
      })
      .finally(() => {
        if (current) setSettled(key);
      });
    return () => {
      current = false;
    };
  }, [key, mutateAsync, enabled]);
  return {
    checked,
    updating: enabled && settled !== key,
    error,
    refresh: () => {
      setRefreshNumber((value) => value + 1);
    },
  };
}
