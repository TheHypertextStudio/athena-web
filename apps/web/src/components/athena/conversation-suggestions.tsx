'use client';

/**
 * The empty-thread prompts offered above {@link AthenaConversation}'s composer.
 *
 * @remarks
 * Split out of `athena-conversation.tsx` to keep that file under the repository's file-length
 * gate; it has no state of its own. Picking a prompt fills the composer rather than sending.
 */
import { Button } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { athenaSuggestions } from '@/lib/athena/suggestions';
import type { PersonalAthenaContext } from '@/lib/athena/presentation';

/** Props for {@link ConversationSuggestions}. */
export interface ConversationSuggestionsProps {
  /** The page presents suggestions as a focused starting point; the rail stays compact. */
  layout?: 'page' | 'panel' | undefined;
  /** The page to draw prompts from, or null for the day's prompts. */
  context: PersonalAthenaContext | null;
  /** Called with the chosen prompt's text; the caller fills the composer rather than sending. */
  onPick: (prompt: string) => void;
}

/**
 * The empty thread's three prompts, drawn from the attached page (or the day, with none): quiet
 * left-aligned text buttons that sit directly above the composer.
 */
export function ConversationSuggestions({
  context,
  onPick,
  layout = 'panel',
}: ConversationSuggestionsProps): JSX.Element {
  return (
    <div className={layout === 'page' ? 'mx-auto w-full max-w-xl' : undefined}>
      {layout === 'page' ? (
        <p className="text-on-surface-variant text-label-medium mb-3">Try asking</p>
      ) : null}
      <ul aria-label="Suggestions" className="flex flex-col gap-2">
        {athenaSuggestions(context).map((prompt) => (
          <li key={prompt}>
            <Button
              type="button"
              variant={layout === 'page' ? 'secondary' : 'ghost'}
              controlSize="xl"
              className="text-body-medium w-full justify-start"
              onClick={() => {
                onPick(prompt);
              }}
            >
              <span className="truncate">{prompt}</span>
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
