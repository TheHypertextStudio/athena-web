import type { JSX } from 'react';

interface DiagramOrg {
  glyph: string;
  name: string;
  kind: string;
  facts: readonly string[];
}

const ORGS: readonly DiagramOrg[] = [
  {
    glyph: 'N',
    name: 'Northwind',
    kind: 'Startup',
    facts: ['Its own team', 'Projects & cycles', 'GitHub · Linear · Slack'],
  },
  {
    glyph: 'R',
    name: 'Riverkeepers',
    kind: 'Nonprofit',
    facts: ['Its own volunteers', 'Campaigns & programs', 'Google Drive'],
  },
  {
    glyph: 'M',
    name: 'Just me',
    kind: 'Personal',
    facts: ['Just you', 'Errands & ideas', 'Your calendar'],
  },
];

/**
 * The core narrative as a picture: three sealed organization spaces — each with its own
 * people, vocabulary, and tools — converging through hairline connectors into one Today
 * spine. Semantic HTML and CSS rules only; the diagram is the argument.
 */
export function SeparationDiagram(): JSX.Element {
  return (
    <section className="border-border border-y">
      <div className="mx-auto w-full max-w-6xl px-6 py-20">
        <div className="flex max-w-2xl flex-col gap-3">
          <p className="text-ink-muted text-sm font-medium">How it holds together</p>
          <h2 className="font-display text-title text-ink tracking-tight text-balance">
            Separation by default. Unification on top.
          </h2>
          <p className="text-ink-muted text-balance">
            Data never merges — each organization stays sealed, with its own people, its own
            vocabulary, its own tools. Views aggregate. Your day is the one place they meet.
          </p>
        </div>

        <div className="mt-14">
          <ul className="grid gap-4 sm:grid-cols-3">
            {ORGS.map((org) => (
              <li key={org.name} className="flex flex-col">
                <div className="border-border bg-paper rounded-md border">
                  <div className="border-border flex items-center gap-2.5 border-b px-4 py-3">
                    <span className="bg-ink text-paper font-display grid size-6 place-items-center rounded-[4px] text-sm">
                      {org.glyph}
                    </span>
                    <span className="text-ink text-body font-semibold">{org.name}</span>
                    <span className="text-ink-muted ml-auto font-mono text-xs">{org.kind}</span>
                  </div>
                  <ul className="px-4 py-3">
                    {org.facts.map((fact) => (
                      <li key={fact} className="text-ink-muted text-body py-0.5">
                        {fact}
                      </li>
                    ))}
                  </ul>
                </div>
                {/* drop line from each org into the shared rail */}
                <span aria-hidden className="bg-border mx-auto block h-8 w-px" />
              </li>
            ))}
          </ul>

          {/* the rail: a single rule the three drop lines land on */}
          <div aria-hidden className="relative mx-auto w-full sm:w-2/3">
            <span className="bg-border absolute inset-x-[16.666%] top-0 block h-px sm:inset-x-0" />
            <span className="bg-border absolute top-0 left-1/2 block h-8 w-px" />
          </div>

          <div className="border-border bg-ink shadow-plate mx-auto mt-8 flex max-w-md items-center justify-between gap-3 rounded-md border px-5 py-3.5">
            <span className="text-paper font-display text-lg tracking-tight">Today</span>
            <span className="text-paper/70 font-mono text-xs">one view · every organization</span>
          </div>
        </div>
      </div>
    </section>
  );
}
