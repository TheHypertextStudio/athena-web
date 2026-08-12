/**
 * Behavior tests for {@link NotionMirrorPanel} — the Docket-in-Notion hub.
 *
 * @remarks
 * The page answers different questions before and after provisioning, and these pin both shapes.
 *
 * Before, the only question is how to start, so the setup card leads and the tables collapse into
 * a preview — they used to be nine expanded rows offering to configure tables that did not exist.
 *
 * After, the questions are where the databases went and how to reach one. Both answers were
 * already stored and neither was rendered: the container page went into the connector config and
 * was never shown again, and each row's `externalUrl` was read from Notion at provision time and
 * dropped on the floor.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeQueryWrapper, okResponse } from '../../support/query';

// Hoisted so the mock factory (lifted above imports) can reference them.
const { integrationsGet, databasesGet, peopleGet, unmatchedGet } = vi.hoisted(() => ({
  integrationsGet: vi.fn(),
  databasesGet: vi.fn(),
  peopleGet: vi.fn(),
  unmatchedGet: vi.fn(),
}));

vi.mock('../../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          integrations: {
            $get: integrationsGet,
            ':id': {
              notion: {
                databases: { $get: databasesGet },
                people: { $get: peopleGet },
                'unmatched-people': { $get: unmatchedGet },
                'parent-pages': { $get: vi.fn() },
                provision: { $post: vi.fn() },
              },
            },
          },
          members: { $get: vi.fn() },
        },
      },
    },
  },
}));

import { NotionMirrorPanel } from '../../../src/components/settings/notion/notion-mirror-panel';

const ORG_ID = 'org_1';

/** A connected Notion integration, optionally carrying a recorded container page. */
function integration(config: Record<string, unknown> = {}) {
  return {
    id: 'int_1',
    organizationId: ORG_ID,
    provider: 'notion',
    pattern: 'connector',
    roles: ['work'],
    connection: { account: 'notion', externalWorkspaceName: 'Las Vegans for Better Transit' },
    status: 'connected',
    config,
    externalAccountId: null,
    syncMode: 'mirror',
    writeBack: false,
    lastSyncStatus: null,
    lastSyncedAt: null,
    lastError: null,
    lastErrorAt: null,
    syncCadenceMinutes: null,
    createdAt: '2026-01-01T00:00:00Z',
  };
}

/** One designed database; `provisionedAt` is what decides which shape the page takes. */
function database(over: Record<string, unknown> = {}) {
  return {
    id: 'db_1',
    entityType: 'task',
    title: 'Tasks',
    direction: 'two_way',
    enabled: true,
    provisionedAt: null,
    externalUrl: null,
    lastPushedAt: null,
    rowCount: 0,
    ...over,
  };
}

function renderPanel(): void {
  const { wrapper } = makeQueryWrapper();
  render(<NotionMirrorPanel orgId={ORG_ID} />, { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  peopleGet.mockResolvedValue(okResponse({ items: [] }));
  unmatchedGet.mockResolvedValue(okResponse({ docketOnly: 0 }));
});

afterEach(cleanup);

describe('NotionMirrorPanel — before anything is provisioned', () => {
  beforeEach(() => {
    integrationsGet.mockResolvedValue(okResponse({ items: [integration()] }));
    databasesGet.mockResolvedValue(okResponse({ items: [database(), database({ id: 'db_2' })] }));
  });

  it('leads with the setup card and folds the tables into a closed preview', async () => {
    renderPanel();
    expect(await screen.findByText('Set up Docket in Notion')).toBeInTheDocument();

    const disclosure = screen.getByText(/What Docket will create/);
    expect(disclosure.closest('details')).not.toHaveAttribute('open');
  });

  it('offers to customize a table, not to configure one that does not exist', async () => {
    renderPanel();
    const links = await screen.findAllByRole('link', { name: 'Customize' });
    expect(links).toHaveLength(2);
    expect(screen.queryByRole('link', { name: 'Configure' })).not.toBeInTheDocument();
  });
});

describe('NotionMirrorPanel — once the databases exist', () => {
  const provisioned = {
    provisionedAt: '2026-01-02T00:00:00Z',
    externalUrl: 'https://www.notion.so/tasks-db',
  };

  // The default: provisioned, but with no container page recorded — the shape an older connection
  // has. Only the first test below overrides it.
  beforeEach(() => {
    integrationsGet.mockResolvedValue(okResponse({ items: [integration()] }));
    databasesGet.mockResolvedValue(okResponse({ items: [database(provisioned)] }));
  });

  it('names the page the databases were built under, and links to it', async () => {
    // Recorded at provision time and, until now, never shown — leaving "where did those nine
    // databases go?" answerable only by searching Notion.
    integrationsGet.mockResolvedValue(
      okResponse({
        items: [
          integration({
            notionMirror: {
              containerPageId: 'page_wiki',
              containerPageTitle: 'Team wiki',
              containerPageUrl: 'https://www.notion.so/team-wiki',
            },
          }),
        ],
      }),
    );
    renderPanel();

    expect(await screen.findByText('Where this lives')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Team wiki/ })).toHaveAttribute(
      'href',
      'https://www.notion.so/team-wiki',
    );
  });

  it('gives every table a way out to the real Notion database', async () => {
    renderPanel();

    expect(await screen.findByRole('link', { name: /Open in Notion/ })).toHaveAttribute(
      'href',
      'https://www.notion.so/tasks-db',
    );
    expect(screen.getByRole('link', { name: 'Configure' })).toBeInTheDocument();
    expect(screen.queryByText('Set up Docket in Notion')).not.toBeInTheDocument();
  });

  it('omits the container row for a connection provisioned before it was recorded', async () => {
    // Older connections stored only the id. The surface has to render without the name rather
    // than show a link to nowhere.
    renderPanel();

    await screen.findByRole('link', { name: 'Configure' });
    expect(screen.queryByText('Where this lives')).not.toBeInTheDocument();
  });
});
