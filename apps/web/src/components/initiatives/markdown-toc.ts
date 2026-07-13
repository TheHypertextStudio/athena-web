/** One h1-h3 entry extracted from an Initiative Markdown document. */
export interface MarkdownHeading {
  readonly level: 1 | 2 | 3;
  readonly text: string;
  readonly id: string;
}

function headingSlug(text: string): string {
  return (
    text
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[`*_~[\]]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'section'
  );
}

/** Extract duplicate-safe, deterministic h1-h3 anchors from Markdown. */
export function extractMarkdownHeadings(markdown: string): MarkdownHeading[] {
  const counts = new Map<string, number>();
  const headings: MarkdownHeading[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const match = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match?.[1] || !match[2]) continue;
    const text = match[2].trim();
    const base = headingSlug(text);
    const count = (counts.get(base) ?? 0) + 1;
    counts.set(base, count);
    headings.push({
      level: match[1].length as 1 | 2 | 3,
      text,
      id: count === 1 ? base : `${base}-${count}`,
    });
  }
  return headings;
}
