'use client';

import { createPortal } from 'react-dom';

/** App-level save failure notice, deliberately outside the quick-create dialog subtree. */
export function CalendarCreateFailureNotice({ visible }: { readonly visible: boolean }) {
  if (!visible || typeof document === 'undefined') return null;
  return createPortal(
    <div
      role="status"
      className="bg-inverse-surface text-inverse-on-surface border-inverse-on-surface/20 text-body-medium fixed bottom-6 left-1/2 z-[140] -translate-x-1/2 rounded-lg border px-4 py-3"
    >
      Calendar item wasn’t saved. Your draft is still open.
    </div>,
    document.body,
  );
}
