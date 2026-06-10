import {
  FolderKanban,
  Home,
  Inbox,
  type LucideIcon,
  RefreshCw,
  Sparkles,
  Users,
} from '@docket/ui/icons';
import type { JSX } from 'react';

interface Feature {
  icon: LucideIcon;
  title: string;
  body: string;
}

const FEATURES: readonly Feature[] = [
  {
    icon: Home,
    title: 'One home, many organizations',
    body: 'Each startup, nonprofit, or side project gets its own space — its own people, settings, and tools — so contexts never bleed together.',
  },
  {
    icon: Inbox,
    title: 'Plan the whole day at once',
    body: 'A single Today view pulls what matters from every organization into one focused plan. Decide what to do; the noise settles.',
  },
  {
    icon: FolderKanban,
    title: 'Structure that fits real work',
    body: 'Initiatives, programs, projects, and tasks — from a one-off campaign launch to an operation that simply never ends.',
  },
  {
    icon: RefreshCw,
    title: 'Bring the tools you already use',
    body: 'Connect Google, Linear, GitHub, and more per organization. Docket coordinates on top of what each team already runs.',
  },
  {
    icon: Sparkles,
    title: 'Work alongside agents',
    body: 'Hand a task to Athena — or your own agent — watch every step, and approve anything before it lands. You stay in control.',
  },
  {
    icon: Users,
    title: 'Keep everyone accountable',
    body: 'Status, health, and updates roll up across every venture into one clear picture you can share with the people who care.',
  },
];

/** Feature grid display showcasing key product capabilities. */
export function FeatureGrid(): JSX.Element {
  return (
    <section id="features" className="mx-auto w-full max-w-6xl scroll-mt-20 px-6 py-20">
      <div className="flex max-w-2xl flex-col gap-3">
        <span className="text-primary text-body font-medium">Everything in one place</span>
        <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          Built for everyone who runs more than one thing
        </h2>
        <p className="text-muted-foreground text-balance">
          Docket gives every organization its own clean context, then unifies your day on top — so
          you can move between ventures without losing the thread.
        </p>
      </div>
      <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature) => {
          const Icon = feature.icon;
          return (
            <div
              key={feature.title}
              className="border-border bg-card flex flex-col gap-3 rounded-xl border p-6"
            >
              <span className="bg-secondary text-secondary-foreground grid size-10 place-items-center rounded-lg">
                <Icon className="size-5" aria-hidden />
              </span>
              <h3 className="text-base font-semibold">{feature.title}</h3>
              <p className="text-muted-foreground text-body">{feature.body}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
