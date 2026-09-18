'use client';

/**
 * The empty-thread prompts offered above {@link AthenaConversation}'s composer.
 *
 * @remarks
 * Split out of `athena-conversation.tsx` to keep that file under the repository's file-length
 * gate; it has no state of its own and exists purely to keep the parent's render small.
 */
import { Button } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { athenaSuggestions } from '@/lib/athena/suggestions';
import type { PersonalAthenaContext } from '@/lib/athena/presentation';

/** Props for {@link ConversationSuggestions}. */
export interface ConversationSuggestionsProps {
  /** The page to draw prompts from, or null for the day's prompts. */
  context: PersonalAthenaContext | null;
  /** Called with the chosen prompt's text; the caller fills the composer rather than sending. */
  onPick: (prompt: string) => void;
}

/** The empty thread's three prompts, drawn from the attached page (or the day, with none). */
export function ConversationSuggestions({
  context,
  onPick,
}: ConversationSuggestionsProps): JSX.Element {
  return (
    <ul aria-label="Suggestions" className="flex flex-col gap-1">
      {athenaSuggestions(context).map((prompt) => (
        <li key={prompt}>
          <Button
            type="button"
            variant="outline"
            className="h-10 w-full justify-start"
            onClick={() => {
              onPick(prompt);
            }}
          >
            <span className="truncate">{prompt}</span>
          </Button>
        </li>
      ))}
    </ul>
  );
}
