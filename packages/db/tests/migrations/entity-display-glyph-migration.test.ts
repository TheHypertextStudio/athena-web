import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, describe, expect, it } from 'vitest';

const migrationsFolder = resolve(import.meta.dirname, '../../drizzle');
const clients: PGlite[] = [];

const EXPECTED_SYMBOL_BY_LEGACY_KEY = {
  target: 'track_changes',
  flag: 'outlined_flag',
  layers: 'layers',
  folder: 'folder_open',
  workflow: 'account_tree',
  globe: 'public',
  users: 'groups',
  sparkles: 'auto_awesome',
  bus: 'directions_bus',
  train: 'train',
  subway: 'subway',
  route: 'route',
  map: 'map',
  campaign: 'campaign',
  school: 'school',
  book: 'menu_book',
  event: 'event',
  handshake: 'handshake',
  government: 'account_balance',
  vote: 'how_to_vote',
  community: 'diversity_3',
  hub: 'hub',
  psychology: 'psychology',
  idea: 'lightbulb',
  launch: 'rocket_launch',
  language: 'language',
  park: 'park',
  building: 'apartment',
  engineering: 'engineering',
  construction: 'construction',
  timeline: 'timeline',
  analytics: 'analytics',
  insights: 'insights',
  growth: 'trending_up',
  verified: 'verified',
  security: 'security',
  energy: 'bolt',
  favorite: 'favorite',
  star: 'star',
  explore: 'explore',
  travel: 'travel_explore',
  award: 'workspace_premium',
  volunteering: 'volunteer_activism',
  forum: 'forum',
  voice: 'record_voice_over',
  podcast: 'podcasts',
  article: 'article',
  policy: 'policy',
  justice: 'gavel',
  library: 'local_library',
  pedestrian: 'emoji_people',
  mail: 'mail',
  chat: 'chat',
  phone: 'phone',
  inbox: 'inbox',
  send: 'send',
  camera: 'camera_alt',
  image: 'image',
  video: 'videocam',
  music: 'music_note',
  film: 'movie',
  wallet: 'account_balance_wallet',
  payments: 'payments',
  receipt: 'receipt_long',
  bank: 'account_balance',
  savings: 'savings',
  science: 'science',
  biotech: 'biotech',
  experiment: 'vaccines',
  atom: 'bubble_chart',
  leaf: 'energy_savings_leaf',
  tree: 'forest',
  flower: 'local_florist',
  water: 'water_drop',
  mountain: 'landscape',
  sun: 'wb_sunny',
  cloud: 'cloud',
  car: 'directions_car',
  flight: 'flight',
  rocket: 'rocket',
  bike: 'directions_bike',
  boat: 'directions_boat',
  build: 'build',
  wrench: 'handyman',
  settings: 'settings',
  tune: 'tune',
  hammer: 'hardware',
  person: 'person',
  group: 'group',
  contacts: 'contacts',
  badge: 'badge',
  note: 'note',
  archive: 'archive',
  clipboard: 'content_paste',
  lock: 'lock',
  shield: 'shield',
  key: 'key',
  fingerprint: 'fingerprint',
  code: 'code',
  terminal: 'terminal',
  database: 'storage',
  bug: 'bug_report',
} as const;

function migrationSql(files: readonly string[]): string {
  return files.map((file) => readFileSync(resolve(migrationsFolder, file), 'utf8')).join('\n');
}

function allMigrationFiles(): readonly string[] {
  return readdirSync(migrationsFolder)
    .filter((file) => file.endsWith('.sql'))
    .sort();
}

afterAll(async () => {
  await Promise.all(clients.map(async (client) => client.close()));
});

describe('entity display glyph migration', () => {
  it('backfills every legacy key without changing its visible symbol', async () => {
    const client = new PGlite('memory://');
    clients.push(client);
    const files = allMigrationFiles();
    const migrationIndex = files.findIndex((file) => file.startsWith('0125_'));
    expect(migrationIndex).toBeGreaterThan(0);
    await client.exec(migrationSql(files.slice(0, migrationIndex)));
    await client.exec(`
      INSERT INTO "organization" ("id", "name", "slug") VALUES ('org1', 'Workspace', 'workspace');
      ${Object.keys(EXPECTED_SYMBOL_BY_LEGACY_KEY)
        .map(
          (key, index) =>
            `INSERT INTO "entity_display" ("id", "organization_id", "subject_type", "subject_id", "icon_key", "color_key") VALUES ('display-${index}', 'org1', 'project', 'project-${index}', '${key}', 'neutral');`,
        )
        .join('\n')}
    `);

    await client.exec(migrationSql(files.slice(migrationIndex, migrationIndex + 1)));

    const stored = await client.query<{
      icon_key: string;
      glyph_kind: string;
      glyph_value: string;
    }>('SELECT "icon_key", "glyph_kind", "glyph_value" FROM "entity_display"');
    expect(stored.rows).toHaveLength(102);
    for (const row of stored.rows) {
      expect(row.glyph_kind).toBe('symbol');
      expect(row.glyph_value).toBe(
        EXPECTED_SYMBOL_BY_LEGACY_KEY[row.icon_key as keyof typeof EXPECTED_SYMBOL_BY_LEGACY_KEY],
      );
    }
  });

  it('allows one shaped symbol or emoji while retaining a valid legacy fallback', async () => {
    const client = new PGlite('memory://');
    clients.push(client);
    await client.exec(migrationSql(allMigrationFiles()));
    await client.exec(`
      INSERT INTO "organization" ("id", "name", "slug") VALUES ('org1', 'Workspace', 'workspace');
      INSERT INTO "entity_display" ("id", "organization_id", "subject_type", "subject_id", "icon_key", "glyph_kind", "glyph_value", "color_key") VALUES
        ('symbol', 'org1', 'project', 'project-1', 'folder', 'symbol', 'rocket_launch', 'neutral'),
        ('emoji', 'org1', 'project', 'project-2', 'folder', 'emoji', '1F44D-1F3FD', 'neutral');
    `);

    await expect(
      client.exec(
        `INSERT INTO "entity_display" ("id", "organization_id", "subject_type", "subject_id", "icon_key", "glyph_kind", "glyph_value", "color_key") VALUES ('bad', 'org1', 'project', 'project-3', 'folder', 'emoji', 'thumbs-up', 'neutral')`,
      ),
    ).rejects.toThrow();
  });
});
