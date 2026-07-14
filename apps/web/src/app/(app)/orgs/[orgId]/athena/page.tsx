'use client';

/**
 * The full-page door onto Athena's persistent chat thread — a focused, deep-linkable session,
 * distinct from the ⌘J {@link AthenaPanelProvider} slide-over onto the SAME thread. Chrome only;
 * the conversation itself lives in {@link AthenaConversation}.
 */
import { useParams } from 'next/navigation';
import type { JSX } from 'react';

import AthenaConversation from '@/components/athena/athena-conversation';

/** AthenaChatPage renders the standalone Athena chat route. */
export default function AthenaChatPage(): JSX.Element {
  const params = useParams<{ orgId: string }>();
  const orgId = params.orgId;

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col p-4 @2xl:p-6">
      <header className="flex flex-col gap-1 pb-4">
        <h1 className="text-on-surface text-title-large">Athena</h1>
        <p className="text-on-surface-variant text-body-medium">
          Ask anything about your work, or hand her a job — she does the busywork, you keep the
          decisions.
        </p>
      </header>
      <AthenaConversation orgId={orgId} className="min-h-0 flex-1" />
    </div>
  );
}
