import type { JSX } from 'react';

interface PreviewTask {
  org: string;
  glyph: string;
  title: string;
  meta: string;
  done?: boolean;
}

const PREVIEW_TASKS: readonly PreviewTask[] = [
  { org: 'Northwind', glyph: 'N', title: 'Ship the launch page', meta: 'Due today · 2h' },
  { org: 'Riverkeepers', glyph: 'R', title: 'Draft the donor update', meta: 'Due today · 1h' },
  {
    org: 'Just me',
    glyph: 'M',
    title: 'Reschedule the team offsite',
    meta: 'This week',
    done: true,
  },
];

/**
 * The honest seam — a live-DOM rendering of the Today view in the app's REAL design
 * language (`.app-seam` restores the product tokens: Plex on MD3 surfaces, app radius),
 * matted on the warm paper with a plate shadow and a typeset caption. No screenshot,
 * no embellishment: what the paper frames is what you sign into.
 */
export function ProductFrame(): JSX.Element {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
      <figure className="mx-auto flex max-w-3xl flex-col gap-4">
        <div className="border-border bg-paper-deep shadow-plate rounded-md border p-2 sm:p-3">
          <div className="app-seam bg-surface-container overflow-hidden rounded-lg font-sans">
            <div className="border-border bg-surface m-1.5 rounded-md border shadow-sm">
              <div className="border-border flex items-baseline justify-between border-b px-4 py-3">
                <p className="text-on-surface text-body-medium font-semibold">Today</p>
                <span className="text-on-surface-variant font-mono text-xs">
                  3 tasks · 3 organizations
                </span>
              </div>
              <ul className="divide-border divide-y">
                {PREVIEW_TASKS.map((task) => (
                  <li key={task.title} className="flex items-center gap-3 px-4 py-2.5">
                    <span
                      aria-hidden
                      className={
                        task.done
                          ? 'border-state-completed bg-state-completed size-4 shrink-0 rounded-full border-[1.5px]'
                          : 'border-outline size-4 shrink-0 rounded-full border-[1.5px]'
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className={`text-body-medium block truncate ${task.done ? 'text-on-surface-variant line-through' : 'text-on-surface'}`}
                      >
                        {task.title}
                      </span>
                    </span>
                    <span className="text-on-surface-variant hidden font-mono text-xs sm:block">
                      {task.meta}
                    </span>
                    <span className="border-outline-variant text-on-surface-variant flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs">
                      <span className="bg-secondary text-secondary-foreground grid size-4 place-items-center rounded-[4px] text-[10px] font-semibold">
                        {task.glyph}
                      </span>
                      {task.org}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
        <figcaption className="text-ink-muted text-center font-mono text-xs">
          Docket itself — the Today view, set in the product&rsquo;s own type. What the paper frames
          is what you sign into.
        </figcaption>
      </figure>
    </section>
  );
}
