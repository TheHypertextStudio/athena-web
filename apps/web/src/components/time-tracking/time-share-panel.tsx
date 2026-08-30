'use client';

/**
 * Sharing what you are working on — the opt-in, and only the opt-in.
 *
 * @remarks
 * The panel exists to make the *scope* legible before anyone agrees to it. It says in plain words
 * what a reader gets (the current task, and only while it is running), offers the one narrowing
 * choice that matters (share the name, or only that you are working), and shows the secret once
 * with the snippet already assembled around it. There is no "make my time public" switch anywhere,
 * because there is no such state — a token or nothing.
 *
 * The token appears exactly once, in the create response, and this panel says so before minting
 * rather than after. Existing shares are listed with when each was last read, which is the honest
 * answer to "is anything still using this?" and the thing that makes revoking a considered act.
 */
import {
  Button,
  Checkbox,
  ControlGroup,
  Field,
  Input,
  Surface,
  Text,
  Textarea,
} from '@docket/ui/primitives';
import { Share } from '@docket/ui/icons';
import type { TimeShareTokenCreated, TimeShareTokenOut } from '@docket/types';
import { type JSX, useState } from 'react';

import { api } from '@/lib/api';
import { STALE, apiQueryOptions, queryKeys, useApiMutation, useApiQuery } from '@/lib/query';
import { userErrorMessage } from '@/lib/problem';

/**
 * Mint, review and revoke current-task share tokens.
 *
 * @returns the share panel.
 */
export function TimeSharePanel(): JSX.Element {
  const [label, setLabel] = useState('');
  const [includeTitle, setIncludeTitle] = useState(true);
  const [includeWorkspace, setIncludeWorkspace] = useState(false);
  const [minted, setMinted] = useState<TimeShareTokenCreated | null>(null);

  const tokensQ = useApiQuery(
    apiQueryOptions(
      queryKeys.timeShareTokens(),
      () => api.v1.time['share-tokens'].$get(),
      'Could not load your shares.',
      { staleTime: STALE.static },
    ),
  );
  const tokens = (tokensQ.data?.items ?? []) as TimeShareTokenOut[];

  const create = useApiMutation({
    mutationFn: async (input: {
      label: string;
      includeTitle: boolean;
      includeWorkspace: boolean;
    }) => {
      const response = await api.v1.time['share-tokens'].$post({ json: input });
      if (!response.ok) throw new Error('Could not create the share.');
      return await response.json();
    },
    invalidateKeys: [queryKeys.timeShareTokens()],
  });

  const revoke = useApiMutation({
    mutationFn: async (id: string) => {
      const response = await api.v1.time['share-tokens'][':id'].$delete({ param: { id } });
      if (!response.ok) throw new Error('Could not revoke the share.');
      return await response.json();
    },
    invalidateKeys: [queryKeys.timeShareTokens()],
  });

  const live = tokens.filter((token) => token.revokedAt === null);

  return (
    <section className="flex min-w-0 flex-col gap-4 px-6 pb-10" aria-labelledby="share-heading">
      <div className="flex min-w-0 flex-col gap-1">
        <Text as="h2" id="share-heading" token="title-medium">
          Show what you are working on
        </Text>
        <Text as="p" token="body-medium" tone="muted" className="max-w-prose">
          Create a link key and a widget on your own website can show the task you are tracking
          right now. It can see nothing else — no history, no totals, no other work — and you can
          turn it off at any time.
        </Text>
      </div>

      <Surface tone="card" shape="medium" className="flex min-w-0 flex-col gap-4 p-5">
        <Field
          label="What is this share for?"
          description="A name for you, so several widgets stay tellable apart."
        >
          <Input
            controlSize="lg"
            value={label}
            placeholder="My personal site"
            onChange={(event) => {
              setLabel(event.target.value);
            }}
          />
        </Field>
        <label className="flex items-center gap-3">
          <Checkbox
            checked={includeTitle}
            onChange={(event) => {
              setIncludeTitle(event.target.checked);
            }}
          />
          <Text token="body-medium">Show the task’s name</Text>
        </label>
        <label className="flex items-center gap-3">
          <Checkbox
            checked={includeWorkspace}
            onChange={(event) => {
              setIncludeWorkspace(event.target.checked);
            }}
          />
          <Text token="body-medium">Show which workspace it belongs to</Text>
        </label>
        <Text as="p" token="body-small" tone="muted">
          The key is shown once, right after you create it, and cannot be recovered afterwards.
        </Text>
        <ControlGroup controlSize="lg">
          <Button
            disabled={label.trim().length === 0 || create.isPending}
            onClick={() => {
              create.mutate(
                { label: label.trim(), includeTitle, includeWorkspace },
                {
                  onSuccess: (result) => {
                    setMinted(result);
                    setLabel('');
                  },
                },
              );
            }}
          >
            <Share aria-hidden="true" />
            Create share key
          </Button>
        </ControlGroup>
        {create.error ? (
          <Text token="body-small" tone="error" role="alert">
            {userErrorMessage(create.error, 'Could not create the share.')}
          </Text>
        ) : null}
      </Surface>

      {minted ? (
        <Surface tone="card" shape="medium" className="flex min-w-0 flex-col gap-3 p-5">
          <Text token="title-small">Copy this now — it is not shown again</Text>
          <Field label="Paste this into your page">
            <Textarea readOnly rows={8} value={minted.embedSnippet} className="font-mono" />
          </Field>
        </Surface>
      ) : null}

      {live.length > 0 ? (
        <ul className="flex min-w-0 flex-col" aria-label="Active shares">
          {live.map((token) => (
            <li key={token.id} className="flex h-12 min-w-0 items-center gap-4 rounded-md px-3">
              <Text token="body-medium" truncate className="min-w-0 flex-1">
                {token.label}
              </Text>
              <Text token="body-small" tone="muted" className="shrink-0">
                {token.lastUsedAt ? 'Read recently' : 'Never read'}
              </Text>
              <ControlGroup controlSize="sm">
                <Button
                  variant="ghost"
                  disabled={revoke.isPending}
                  onClick={() => {
                    revoke.mutate(token.id);
                  }}
                >
                  Turn off
                </Button>
              </ControlGroup>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
