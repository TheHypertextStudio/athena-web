/**
 * The workspace-provisioning contract (WIL-05).
 *
 * @remarks
 * Two things about `scripts/provision-workspaces.ts` are worth holding still, and neither is
 * observable by running it once against a fresh database:
 *
 * 1. **The eight names are the requirement.** They were given character-for-character, including
 *    "Willie Enterprises (dba Vibe Code Cleanup Company)". A well-meaning tidy-up — dropping the
 *    parenthetical, title-casing "for", trimming "The" — silently fails the acceptance, so the
 *    literal strings are asserted here rather than left to review.
 * 2. **The reconciliation is what makes a second run safe.** Adopt-by-name, adopt-the-personal-
 *    space, adopt-by-slug, else create. Get any of those wrong and the tool duplicates a
 *    workspace instead of leaving it alone, which is the exact failure it exists to prevent.
 *
 * The slug function is pinned against the API's own `slugify`, because the script deliberately
 * carries a copy (it has to run against a remote API) and a silent drift would break the
 * adopt-by-slug rule without breaking anything else.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  matchExisting,
  TARGET_WORKSPACES,
  workspaceSlug,
} from '../../scripts/provision-workspaces';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** The author's list, exactly as written. */
const AUTHORED_NAMES = [
  'Personal Life',
  'The Willie Diaries',
  'Las Vegans for Better Transit',
  'Reasonable Tech Company',
  'Hypertext Studio',
  'Rebuilding America Project',
  'Project Oasis',
  'Willie Enterprises (dba Vibe Code Cleanup Company)',
];

describe('provision-workspaces — the eight names', () => {
  it('carries every name character-for-character, in order', () => {
    expect(TARGET_WORKSPACES.map((w) => w.name)).toEqual(AUTHORED_NAMES);
  });

  it('marks exactly one of them — Personal Life — as the personal workspace', () => {
    const personal = TARGET_WORKSPACES.filter((w) => w.personal);
    expect(personal.map((w) => w.name)).toEqual(['Personal Life']);
  });

  it('gives every workspace a purpose, so none lands blank in its settings', () => {
    for (const target of TARGET_WORKSPACES) {
      expect(target.purpose.length, target.name).toBeGreaterThan(0);
    }
  });
});

describe('provision-workspaces — slug derivation', () => {
  it('mirrors the API helper it copies', () => {
    // The script cannot import `apps/api/src/routes/org-helpers` — that module opens a database
    // connection, and the script's whole point is running against a *remote* API. So the copy is
    // pinned by comparing the two function bodies with whitespace normalized: a reformat passes,
    // a changed rule fails, and the failure names the file to fix.
    const apiSource = readFileSync(`${REPO_ROOT}apps/api/src/routes/org-helpers.ts`, 'utf8');
    const scriptSource = readFileSync(`${REPO_ROOT}scripts/provision-workspaces.ts`, 'utf8');

    const bodyOf = (source: string, signature: RegExp): string => {
      const match = signature.exec(source);
      if (!match?.[1]) throw new Error('slug function not found — was it renamed?');
      return match[1].replace(/\s+/g, ' ').trim();
    };

    expect(
      bodyOf(
        scriptSource,
        /export function workspaceSlug\(name: string\): string \{([\s\S]*?)\n\}/,
      ),
    ).toBe(bodyOf(apiSource, /export function slugify\(name: string\): string \{([\s\S]*?)\n\}/));
  });

  it('derives the slug the adopt rule depends on', () => {
    expect(workspaceSlug('Las Vegans for Better Transit')).toBe('las-vegans-for-better-transit');
    expect(workspaceSlug('Willie Enterprises (dba Vibe Code Cleanup Company)')).toBe(
      'willie-enterprises-dba-vibe-code-cleanup-company',
    );
  });
});

describe('provision-workspaces — reconciliation', () => {
  const target = (name: string) => {
    const found = TARGET_WORKSPACES.find((w) => w.name === name);
    if (!found) throw new Error(`no target named ${name}`);
    return found;
  };

  it('adopts an exact name match, so a second run changes nothing', () => {
    const existing = [
      { id: 'o1', name: 'Project Oasis', slug: 'project-oasis', isPersonal: false },
    ];
    expect(matchExisting(target('Project Oasis'), existing)?.id).toBe('o1');
  });

  it('claims the account personal space for Personal Life whatever it is called', () => {
    const existing = [
      { id: 'p1', name: "lane's space", slug: 'personal-lane', isPersonal: true },
      { id: 'o1', name: 'Hypertext Studio', slug: 'hypertext-studio', isPersonal: false },
    ];
    expect(matchExisting(target('Personal Life'), existing)?.id).toBe('p1');
  });

  it('adopts a workspace already carrying the target slug rather than duplicating it', () => {
    // The exact case this rule exists for: an audit left a workspace with the right slug under a
    // working name. Creating beside it would mint `las-vegans-for-better-transit-2`.
    const existing = [
      {
        id: 'o9',
        name: 'ZZ Audit Probe Workspace (delete me)',
        slug: 'las-vegans-for-better-transit',
        isPersonal: false,
      },
    ];
    const match = matchExisting(target('Las Vegans for Better Transit'), existing);
    expect(match?.id).toBe('o9');
  });

  it('never adopts the personal space for a shared target', () => {
    const existing = [{ id: 'p1', name: 'Personal Life', slug: 'project-oasis', isPersonal: true }];
    expect(matchExisting(target('Project Oasis'), existing)).toBeNull();
  });

  it('creates when nothing matches', () => {
    const existing = [
      { id: 'o1', name: 'Something Else', slug: 'something-else', isPersonal: false },
    ];
    expect(matchExisting(target('Rebuilding America Project'), existing)).toBeNull();
  });
});
