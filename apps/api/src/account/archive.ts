/**
 * `@docket/api` — the personal-data export archive (a ZIP with a human README).
 *
 * @remarks
 * Turns the raw {@link ExportDocument} collected from the database into a self-describing ZIP:
 * a Markdown `README.md` (what the export is, when it was made, a summary, and a guide to every
 * file), plus pretty-printed JSON split into readable parts (`account.json`, one file per
 * workspace under `workspaces/`, `personal.json`) and a machine-readable `manifest.json`. Built
 * synchronously with `fflate` (zero-dependency, runs anywhere) so the export sweep can produce the
 * bytes in one call before handing them to the blob store.
 */
import type { AccountExportScope } from '@docket/types';
import { strToU8, zipSync } from 'fflate';

/** The structured export payload collected for one user (the input to the archive). */
export interface ExportDocument {
  /** The export schema version (bumped when the shape changes). */
  readonly schemaVersion: number;
  /** Identity: the user profile, linked external accounts, and authorized apps. */
  readonly identity: unknown;
  /** Cross-workspace personal data (notifications, observations, digests, plans, follows). */
  readonly personal: Record<string, unknown> | null;
  /** One entry per workspace the user belongs to, each with that workspace's work layer. */
  readonly memberships: readonly {
    readonly organization: {
      readonly id: string;
      readonly slug: string | null;
      readonly name: string;
    };
    readonly work: Record<string, unknown[]>;
  }[];
  /** The categories and workspaces included in this archive. */
  readonly scope: AccountExportScope;
}

/** Generation metadata stamped into the README + manifest. */
export interface ExportArchiveMeta {
  /** ISO-8601 instant the export was generated. */
  readonly generatedAt: string;
  /** ISO-8601 instant the download link expires. */
  readonly expiresAt: string;
  /** The account holder's display name (for the README greeting), or null. */
  readonly name: string | null;
  /** The account holder's email, or null. */
  readonly email: string | null;
}

/** A filesystem-safe slug for filenames (lowercase, hyphenated), never empty. */
export function exportSlug(value: string | null): string {
  const slug = (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'account';
}

/**
 * An intelligent, unique download filename for one export — e.g.
 * `docket-export-ada-lovelace-2026-06-29-143052.zip`.
 *
 * @param name - The account holder's name (slugified into the filename).
 * @param readyAt - When the export became ready (its date + time make the name unique).
 */
export function exportFilename(name: string | null, readyAt: Date): string {
  const iso = readyAt.toISOString();
  const stamp = `${iso.slice(0, 10)}-${iso.slice(11, 19).replace(/:/g, '')}`;
  return `docket-export-${exportSlug(name)}-${stamp}.zip`;
}

/** Count the rows in a work-layer collection (0 when absent). */
function count(work: Record<string, unknown[]>, key: string): number {
  const value = work[key];
  return Array.isArray(value) ? value.length : 0;
}

/** Count the rows in a personal collection (0 when absent). */
function countPersonal(personal: Record<string, unknown> | null, key: string): number {
  if (personal === null) return 0;
  const value = personal[key];
  return Array.isArray(value) ? value.length : 0;
}

/** Render the human-facing README.md for the archive. */
function renderReadme(doc: ExportDocument, meta: ExportArchiveMeta): string {
  let tasks = 0;
  let projects = 0;
  let comments = 0;
  for (const m of doc.memberships) {
    tasks += count(m.work, 'task');
    projects += count(m.work, 'project');
    comments += count(m.work, 'comment');
  }
  const who = meta.name
    ? `${meta.name}${meta.email ? ` <${meta.email}>` : ''}`
    : (meta.email ?? 'your account');

  const includesAccount = doc.scope.categories.includes('account');
  const includesPersonal = doc.scope.categories.includes('personal');
  const includesWorkspaces = doc.scope.categories.includes('workspaces');
  const containsEverything =
    includesAccount && includesPersonal && includesWorkspaces && doc.scope.allWorkspaces;
  const included = [
    includesAccount ? 'Account information' : null,
    includesPersonal ? 'Personal Docket data' : null,
    includesWorkspaces
      ? doc.scope.allWorkspaces
        ? 'All workspaces available when generated'
        : `${doc.memberships.length} selected workspace${doc.memberships.length === 1 ? '' : 's'}`
      : null,
  ].filter((value): value is string => value !== null);

  return `# Your Docket data export

This archive contains ${
    containsEverything ? 'a complete copy of everything Docket holds' : 'the data you selected'
  } for ${who}, at the moment it was generated.

- **Generated:** ${meta.generatedAt}
- **Download link expires:** ${meta.expiresAt}
- **Schema version:** ${doc.schemaVersion}

## Summary

- Included: ${included.join('; ')}
- Workspaces: ${doc.memberships.length}
- Projects: ${projects}
- Tasks: ${tasks}
- Comments: ${comments}
- Notifications: ${countPersonal(doc.personal, 'notifications')}
- Activity records (observations): ${countPersonal(doc.personal, 'observations')}

## What's inside

- ${includesAccount ? "`account.json` — your profile, the external accounts you've linked (Google, GitHub, …), and the apps you've authorized." : 'Account information was not selected.'}
- ${includesWorkspaces ? "`workspaces/` — one file per selected workspace, each containing that workspace's work: projects, tasks, milestones, cycles, comments, updates, labels, and saved views." : 'Workspace data was not selected.'}
- ${includesPersonal ? '`personal.json` — your cross-workspace personal data: notifications, activity (observations), daily plans, daily digests, and the things you follow.' : 'Personal Docket data was not selected.'}
- \`manifest.json\` — a machine-readable summary (schema version, timestamps, counts).

## Notes

- All timestamps are ISO-8601 in UTC.
- This export is a point-in-time snapshot; it is not updated after generation.
- The data is yours. If you scheduled account deletion, downloading this is the way to keep a copy before your data is permanently removed.

— Docket
`;
}

/**
 * Build the export ZIP (README + split JSON) from a collected {@link ExportDocument}.
 *
 * @param doc - The structured export payload.
 * @param meta - Generation metadata (timestamps + who).
 * @returns the ZIP archive bytes (`application/zip`).
 */
export function buildExportArchive(doc: ExportDocument, meta: ExportArchiveMeta): Uint8Array {
  const files: Record<string, Uint8Array> = {
    'README.md': strToU8(renderReadme(doc, meta)),
    'manifest.json': strToU8(
      JSON.stringify(
        {
          schemaVersion: doc.schemaVersion,
          generatedAt: meta.generatedAt,
          expiresAt: meta.expiresAt,
          scope: doc.scope,
          workspaceCount: doc.memberships.length,
        },
        null,
        2,
      ),
    ),
  };
  if (doc.scope.categories.includes('account') && doc.identity !== null) {
    files['account.json'] = strToU8(JSON.stringify(doc.identity, null, 2));
  }
  if (doc.scope.categories.includes('personal') && doc.personal !== null) {
    files['personal.json'] = strToU8(JSON.stringify(doc.personal, null, 2));
  }
  for (const m of doc.memberships) {
    const base = exportSlug(m.organization.slug ?? m.organization.name);
    // Org slugs are globally unique, but suffix the id to be collision-proof either way.
    files[`workspaces/${base}-${m.organization.id.slice(-6)}.json`] = strToU8(
      JSON.stringify(m, null, 2),
    );
  }
  return zipSync(files, { level: 6 });
}
