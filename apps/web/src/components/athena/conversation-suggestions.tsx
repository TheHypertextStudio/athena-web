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
}: ConversationSuggestionsProps): JSX.Element {
  return (
    <ul aria-label="Suggestions" className="flex flex-col">
      {athenaSuggestions(context).map((prompt) => (
        <li key={prompt}>
          <Button
            type="button"
            variant="ghost"
            controlSize="xl"
            className="text-on-surface-variant text-body-medium w-full justify-start"
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
