'use client';

import type { OrgCreate } from '@docket/types';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Input,
} from '@docket/ui/primitives';
import { cn } from '@docket/ui/lib/utils';
import { useRouter } from 'next/navigation';
import { type JSX, useState } from 'react';

import { rememberDefaultTeam } from '@/lib/active-team';
import { api } from '@/lib/api';
import { readError, readProblem } from '@/lib/problem';

/** The intent a new user picks; maps to the org's `intent` + a default vocabulary preset. */
type Intent = OrgCreate['intent'];

/** The selectable vocabulary preset for the new org. */
type Vocabulary = OrgCreate['vocabulary'];

/** One intent option rendered as a selectable card. */
interface IntentOption {
  /** The `OrgCreate.intent` value this option submits. */
  intent: Exclude<Intent, undefined>;
  /** Card title. */
  title: string;
  /** Supporting description. */
  description: string;
  /** The vocabulary preset this intent defaults to. */
  vocabulary: Vocabulary;
}

/** The default (first) intent option, pre-selected on first render. */
const DEFAULT_INTENT: IntentOption = {
  intent: 'startup',
  title: 'Startup or team',
  description: 'Programs, projects, and cycles for a growing company.',
  vocabulary: 'startup',
};

/** The three onboarding intent forks and their default vocabulary presets. */
const INTENT_OPTIONS: readonly IntentOption[] = [
  DEFAULT_INTENT,
  {
    intent: 'nonprofit',
    title: 'Nonprofit',
    description: 'Initiatives and campaigns for mission-driven work.',
    vocabulary: 'nonprofit',
  },
  {
    intent: 'personal',
    title: 'Just me',
    description: 'A focused space to run your own work.',
    vocabulary: 'startup',
  },
];

/** The vocabulary presets a user can pick, with a short gloss of what they rename. */
const VOCABULARY_OPTIONS: readonly { value: Vocabulary; label: string; hint: string }[] = [
  { value: 'startup', label: 'Startup', hint: 'Projects, Cycles, Teams' },
  { value: 'nonprofit', label: 'Nonprofit', hint: 'Initiatives, Campaigns, Chapters' },
  { value: 'agency', label: 'Agency', hint: 'Engagements, Sprints, Pods' },
];

/**
 * The first-run onboarding screen: pick an intent, name the org, choose a vocabulary.
 *
 * @remarks
 * A Client Component run right after sign-up. It forks on intent (startup / nonprofit /
 * just me), each pre-selecting a sensible vocabulary preset the user can still change, then
 * creates the organization via the typed RPC (`api.v1.orgs.$post`). On success it remembers
 * the returned default team id (so the work view can create tasks immediately) and routes
 * into the new org's "My Work" view. The `Problem` response body is surfaced inline on failure.
 */
export default function OnboardingPage(): JSX.Element {
  const router = useRouter();
  const [intent, setIntent] = useState<IntentOption>(DEFAULT_INTENT);
  const [name, setName] = useState('');
  const [vocabulary, setVocabulary] = useState<Vocabulary>(DEFAULT_INTENT.vocabulary);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  /** Select an intent card and adopt its default vocabulary preset. */
  function chooseIntent(option: IntentOption): void {
    setIntent(option);
    setVocabulary(option.vocabulary);
  }

  /** Create the organization, remember its default team, and route into its work view. */
  async function submit(): Promise<void> {
    setError(null);
    setPending(true);
    try {
      const res = await api.v1.orgs.$post({
        json: { name, vocabulary, intent: intent.intent, isPersonal: false },
      });
      if (!res.ok) {
        setError(await readProblem(res, 'Could not create your organization. Please try again.'));
        return;
      }
      const { organization, defaultTeam } = await res.json();
      rememberDefaultTeam(organization.id, defaultTeam.id);
      router.push(`/orgs/${organization.id}/my-work`);
    } catch (caught) {
      setError(
        readError(caught, 'Something went wrong setting up your organization. Please try again.'),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="bg-background flex min-h-screen items-center justify-center px-6 py-12">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="text-2xl">Set up your workspace</CardTitle>
          <CardDescription>Tell us a little about what you&apos;re organizing.</CardDescription>
        </CardHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <CardContent className="flex flex-col gap-6">
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">What are you setting up?</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {INTENT_OPTIONS.map((option) => {
                  const selected = option.intent === intent.intent;
                  return (
                    <button
                      key={option.intent}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => {
                        chooseIntent(option);
                      }}
                      className={cn(
                        'flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors',
                        selected
                          ? 'border-primary bg-accent text-accent-foreground'
                          : 'border-border hover:bg-accent/50',
                      )}
                    >
                      <span className="text-sm font-medium">{option.title}</span>
                      <span className="text-muted-foreground text-xs">{option.description}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="org-name" className="text-sm font-medium">
                Organization name
              </label>
              <Input
                id="org-name"
                type="text"
                required
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                }}
                placeholder="Acme Inc."
              />
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Vocabulary</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {VOCABULARY_OPTIONS.map((option) => {
                  const selected = option.value === vocabulary;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => {
                        setVocabulary(option.value);
                      }}
                      className={cn(
                        'flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors',
                        selected
                          ? 'border-primary bg-accent text-accent-foreground'
                          : 'border-border hover:bg-accent/50',
                      )}
                    >
                      <span className="text-sm font-medium">{option.label}</span>
                      <span className="text-muted-foreground text-xs">{option.hint}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {error ? (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            ) : null}
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" disabled={pending || name.trim().length === 0}>
              {pending ? 'Creating workspace…' : 'Create workspace'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}
